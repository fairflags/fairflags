// FairFlags Season 1: check every sign-up wallet with the game's own bot rules and build the final qualifying list.
// Read-only: never signs anything. Uses the PUBLIC mainnet RPC (no keys) and the public list at /api/signups.
// Run: node signup-check.mjs [--url https://fairflags.pages.dev] [--file signups.json]
// Output: out/season1-check.json (full, per wallet) and out/season1-result.md (short, publishable).
import fs from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { RULES } from "./scorer.js";

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const SITE = arg("--url", "https://fairflags.pages.dev");
const RPC = process.env.CHECK_RPC || "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Q = { captains: 1, fans: 20, spots: 16, minCountries: 8 };
const BUSY_FUNDER_TXS = 1000;   // a funder with 1000+ transactions looks like an exchange / service wallet, not a farm: never counted as a cluster
const CACHE = "out/season1-wallet-cache.json";
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const SHARED = new Set((fs.existsSync("shared-funders-mainnet.json") ? JSON.parse(fs.readFileSync("shared-funders-mainnet.json", "utf8")) : []).map((s) => s.address));

async function retry(fn) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 6) throw e; await sleep(3000 * (i + 1)); } } }

async function info(w) {
  if (cache[w]) return cache[w];
  const sigs = await retry(() => conn.getSignaturesForAddress(new PublicKey(w), { limit: 1000 }));
  const oldest = sigs.at(-1);
  let funder = null;
  if (oldest && sigs.length < 1000) {                     // only fully known histories have a known first funder
    const tx = await retry(() => conn.getTransaction(oldest.signature, { maxSupportedTransactionVersion: 0 }));
    const keys = tx?.transaction.message.staticAccountKeys || tx?.transaction.message.accountKeys || [];
    if (keys[0] && keys[0].toBase58() !== w) funder = keys[0].toBase58();
  }
  // 1000+ transactions: the oldest one is beyond what we fetch, so the age is unknown but the wallet is clearly not fresh
  const r = { ageDays: sigs.length >= 1000 ? 9999 : oldest?.blockTime ? (Date.now() / 1000 - oldest.blockTime) / 86400 : 0, txs: sigs.length, funder };
  cache[w] = r; await sleep(350);
  return r;
}
async function busy(addr) {
  const k = "busy:" + addr;
  if (cache[k] != null) return cache[k];
  const sigs = await retry(() => conn.getSignaturesForAddress(new PublicKey(addr), { limit: BUSY_FUNDER_TXS }));
  cache[k] = sigs.length >= BUSY_FUNDER_TXS; await sleep(350);
  return cache[k];
}

const src = arg("--file") ? JSON.parse(fs.readFileSync(arg("--file"), "utf8")) : await (await fetch(SITE + "/api/signups")).json();
const signups = src.signups || [];
console.log("sign-ups:", signups.length, "| rules: age >=", RULES.minWalletAgeDays, "days, >=", RULES.minWalletTxs, "txs, cluster >", RULES.clusterMax, "same funder per country");

for (const [i, s] of signups.entries()) {
  try { Object.assign(s, await info(s.wallet)); } catch (e) { s.error = String(e.message).slice(0, 80); }
  if ((i + 1) % 25 === 0) { console.log("checked", i + 1); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
}
// same-funder clusters, per country, like the game
const byFunder = new Map();
for (const s of signups) if (s.funder) { const k = s.country + "|" + s.funder; byFunder.set(k, (byFunder.get(k) || 0) + 1); }
for (const [k, n] of byFunder) { const f = k.split("|")[1]; if (n > RULES.clusterMax && !SHARED.has(f) && (await busy(f))) SHARED.add(f); }

for (const s of signups) {
  if (s.error) s.reason = "lookup failed (re-run)";
  else if (s.ageDays < RULES.minWalletAgeDays) s.reason = "wallet too new";
  else if (s.txs < RULES.minWalletTxs) s.reason = "too little history";
  else if (s.funder && !SHARED.has(s.funder) && byFunder.get(s.country + "|" + s.funder) > RULES.clusterMax) s.reason = "same-funder cluster";
  s.counts = !s.reason;
}
const countries = {};
for (const s of signups) {
  const c = (countries[s.country] ||= { fans: 0, captains: 0, removed: 0, reasons: {} });
  if (s.counts) { c.fans++; if (s.captain) c.captains++; } else { c.removed++; c.reasons[s.reason] = (c.reasons[s.reason] || 0) + 1; }
}
const ranked = Object.entries(countries).filter(([c]) => !c.startsWith("Other")).sort((a, b) => b[1].fans - a[1].fans);
const qualified = ranked.filter(([, v]) => v.fans >= Q.fans && v.captains >= Q.captains).slice(0, Q.spots).map(([c]) => c);
const result = { checked: new Date().toISOString(), rules: { ...RULES, busyFunderTxs: BUSY_FUNDER_TXS }, qualify: Q, total: signups.length, counted: signups.filter((s) => s.counts).length,
  qualified, launch: qualified.length >= Q.minCountries, countries, sharedFunders: [...SHARED], signups: signups.map(({ wallet, country, captain, ageDays, txs, funder, counts, reason }) => ({ wallet, country, captain, ageDays: +(+ageDays || 0).toFixed(1), txs, funder, counts, reason })) };
fs.mkdirSync("out", { recursive: true });
fs.writeFileSync(CACHE, JSON.stringify(cache));
fs.writeFileSync("out/season1-check.json", JSON.stringify(result, null, 1));

const md = [`# FairFlags Season 1: qualifying result`, ``, `Checked ${result.checked}. ${result.total} sign-ups, ${result.counted} counted after the bot check.`, ``,
  `| # | Country | Real fans | Captains | Removed | Status |`, `|---|---|---|---|---|---|`,
  ...ranked.map(([c, v], i) => `| ${i + 1} | ${c} | ${v.fans} | ${v.captains} | ${v.removed} | ${qualified.includes(c) ? "QUALIFIED" : v.fans >= Q.fans && v.captains >= Q.captains ? "qualified, no spot left" : "not yet"} |`), ``,
  result.launch ? `**${qualified.length} countries qualify. Season 1 goes ahead.**` : `**Only ${qualified.length} countries qualify (8 needed). Season 1 waits.**`, ``,
  `Removed wallets were brand new, had too little history, or were part of a same-funder cluster. Every wallet and reason: season1-check.json.`];
fs.writeFileSync("out/season1-result.md", md.join("\n"));
console.log(md.join("\n"));
