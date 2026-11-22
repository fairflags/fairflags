// Reads every swap of every FairFlags pool (DEVNET), turns them into trades, looks up the buyers' wallet history, and scores the bracket with scorer.js.
// Output: out/scoreboard.json (read by the scoreboard page). Pools from out/pools-devnet.json (+ the first prototype pool CARG). Read-only: never signs anything.
import fs from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { scoreRound, matchWinner, snapshotTime, RULES } from "./scorer.js";
import { NATIONS } from "./nations.js";

const RPC = process.env.RPC || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WSOL = "So11111111111111111111111111111111111111112";
const CACHE = "out/index-cache.json";
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : { trades: {}, seen: {}, wallets: {} };
async function retry(fn) { for (let i = 0; i < 6; i++) { try { return await fn(); } catch (e) { if (i === 5) throw e; await sleep(3000 * (i + 1)); } } }

// tournament config: round 1 starts when the owner sets it; until then scores are "since the pools opened"
const CUP = fs.existsSync("cup-config.json") ? JSON.parse(fs.readFileSync("cup-config.json", "utf8")) : { start: null, roundHours: 48, snapshotWindowHours: 12 };
// effective rules = published defaults + optional overrides from cup-config.json ("rules": {...}, e.g. a relaxed devnet test) + the public shared-funder list
const SHARED = fs.existsSync("shared-funders.json") ? JSON.parse(fs.readFileSync("shared-funders.json", "utf8")) : [];
const EFFECTIVE = { ...RULES, ...(CUP.rules || {}), sharedFunders: SHARED.map((s) => s.address) };
const TEST_MODE = !!CUP.rules;

function pools() {
  const p = fs.existsSync("out/pools-devnet.json") ? JSON.parse(fs.readFileSync("out/pools-devnet.json", "utf8")) : [];
  const toks = JSON.parse(fs.readFileSync("out/tokens-devnet.json", "utf8"));
  const map = new Map(p.map((x) => [x.symbol, x]));
  if (!map.has("CARG") && process.env.CARG_PAIR) map.set("CARG", { symbol: "CARG", mint: toks.find((t) => t.symbol === "CARG").mint, pair: process.env.CARG_PAIR });
  return map;
}

async function fetchTrades(sym, pool) {
  const known = (cache.seen[pool.pair] ||= []);
  const sigs = await retry(() => conn.getSignaturesForAddress(new PublicKey(pool.pair), { limit: 200 }));
  const fresh = sigs.filter((s) => !s.err && !known.includes(s.signature)).reverse();
  for (const s of fresh) {
    const tx = await retry(() => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }));
    known.push(s.signature);
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
    const payer = keys[0].toBase58();
    const bal = (list, mint) => (list || []).filter((b) => b.mint === mint && b.owner === pool.pair).reduce((a, b) => a + (+b.uiTokenAmount.uiAmountString || 0), 0);
    const dTok = bal(tx.meta.postTokenBalances, pool.mint) - bal(tx.meta.preTokenBalances, pool.mint);
    const dSol = bal(tx.meta.postTokenBalances, WSOL) - bal(tx.meta.preTokenBalances, WSOL);
    if (dSol > 0 && dTok < 0) (cache.trades[sym] ||= []).push({ t: tx.blockTime, slot: tx.slot, coin: sym, wallet: payer, side: "buy", sol: dSol, tokens: -dTok, sig: s.signature });
    else if (dSol < 0 && dTok > 0) (cache.trades[sym] ||= []).push({ t: tx.blockTime, slot: tx.slot, coin: sym, wallet: payer, side: "sell", sol: -dSol, tokens: dTok, sig: s.signature });
    await sleep(400);
  }
}

async function walletInfo(w) {
  const c = cache.wallets[w];
  if (c && Date.now() / 1000 - c.at < 6 * 3600) return c;
  const sigs = await retry(() => conn.getSignaturesForAddress(new PublicKey(w), { limit: 1000 }));
  const oldest = sigs.at(-1);
  let funder = null;
  if (oldest && sigs.length < 1000) {
    const tx = await retry(() => conn.getTransaction(oldest.signature, { maxSupportedTransactionVersion: 0 }));
    const keys = tx?.transaction.message.staticAccountKeys || tx?.transaction.message.accountKeys || [];
    if (keys[0] && keys[0].toBase58() !== w) funder = keys[0].toBase58();
  }
  const info = { ageDays: oldest?.blockTime ? (Date.now() / 1000 - oldest.blockTime) / 86400 : 0, txs: sigs.length, funder, at: Date.now() / 1000 };
  cache.wallets[w] = info;
  await sleep(400);
  return info;
}

export async function runIndex() {
  const P = pools();
  for (const [sym, pool] of P) { try { await fetchTrades(sym, pool); } catch (e) { console.log("trades failed", sym, String(e.message).slice(0, 80)); } }
  const trades = Object.values(cache.trades).flat();
  const wallets = new Map();
  for (const w of new Set(trades.filter((t) => t.side === "buy").map((t) => t.wallet))) wallets.set(w, await walletInfo(w));
  const now = Math.floor(Date.now() / 1000);
  // bracket: the 32 nations in list order, pairs (1v2, 3v4, ...). Before the cup starts: one open "preview" window since the pools opened.
  const order = NATIONS.map((n) => n.symbol);
  const rounds = [];
  let alive = order;
  const start = CUP.start ? Date.parse(CUP.start) / 1000 : null;
  const names = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];
  for (let r = 0; r < 5 && alive.length >= 2; r++) {
    const rs = start ? start + r * CUP.roundHours * 3600 : 0, re = start ? rs + CUP.roundHours * 3600 : now + 1;
    const status = !start ? "preview" : now < rs ? "upcoming" : now < re ? "live" : "finished";
    const snapT = status === "finished" ? snapshotTime(`round-${r}-${CUP.start}`, re - CUP.snapshotWindowHours * 3600, re) : now; // MVP: deterministic seed; real cup: a future block hash
    const sc = status === "upcoming" ? {} : scoreRound(trades, wallets, alive, rs, re, snapT, EFFECTIVE);
    const matches = [];
    for (let i = 0; i < alive.length; i += 2) {
      const a = alive[i], b = alive[i + 1];
      const winner = status === "finished" ? matchWinner(sc, a, b) : null;
      matches.push({ a, b, scoreA: sc[a]?.score ?? 0, scoreB: sc[b]?.score ?? 0, netA: sc[a]?.netSol ?? 0, netB: sc[b]?.netSol ?? 0, volA: sc[a]?.volumeSol ?? 0, volB: sc[b]?.volumeSol ?? 0, excludedA: sc[a]?.excluded, excludedB: sc[b]?.excluded, winner });
    }
    rounds.push({ name: names[r], status, start: rs || null, end: start ? re : null, matches });
    if (status !== "finished") break;
    alive = matches.map((m) => m.winner);
  }
  const fees = trades.reduce((s, t) => s + t.sol * 0.008, 0);     // pool keeps 0.8% of each trade (1% fee - 20% protocol share)
  const out = { updated: now, network: "devnet", rules: EFFECTIVE, testMode: TEST_MODE, sharedFunders: SHARED, cup: CUP, pools: [...P.values()].map((p) => ({ symbol: p.symbol, pair: p.pair, mint: p.mint })), trades: trades.length,
    treasury: { feesSol: +fees.toFixed(6), organiserSharePct: 12.5, prizeSharePct: 87.5, prizeSol: +(fees * 0.875).toFixed(6), organiserSol: +(fees * 0.125).toFixed(6) }, rounds };
  fs.writeFileSync("out/scoreboard.json", JSON.stringify(out));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("indexer.js")) { const o = await runIndex(); console.log("indexed", o.trades, "trades in", o.pools.length, "pools; round", o.rounds[0]?.name, o.rounds[0]?.status); }
