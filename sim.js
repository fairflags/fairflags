// Simulation: does the scoring pick the coin with REAL buyers even when another coin runs a bot farm with huge fake volume?
// Run: node sim.js
import { scoreRound, matchWinner, snapshotTime, RULES } from "./scorer.js";

let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const T0 = 1_800_000_000, ROUND = 48 * 3600, wallets = new Map(), trades = [];
let wid = 0, slot = 1000;
const newWallet = (info) => { const w = "w" + wid++; wallets.set(w, info); return w; };
const priceTok = 1e6; // tokens per SOL (flat, enough for scoring)

// coin A: 60 real buyers (old wallets, own funders), spread over the round, some sell part
function realCommunity(coin, n) {
  for (let i = 0; i < n; i++) {
    const w = newWallet({ ageDays: 30 + rnd() * 900, txs: 50 + Math.floor(rnd() * 5000), funder: "cex" + Math.floor(rnd() * 20) + "_" + i });
    const t = T0 + rnd() * ROUND * 0.9, sol = 0.05 + rnd() * 1.5;
    trades.push({ t, slot: slot += 1 + Math.floor(rnd() * 50), coin, wallet: w, side: "buy", sol, tokens: sol * priceTok });
    if (rnd() < 0.3) trades.push({ t: t + 3600 * (1 + rnd() * 20), slot: slot += 7, coin, wallet: w, side: "sell", sol: sol * 0.3, tokens: sol * 0.3 * priceTok });
  }
}
// coin B: a bot farm - 400 fresh wallets funded by 5 sources, bundled buys, wash trading 50x the volume, plus 15 real buyers
function botFarm(coin, bots, real) {
  const funders = ["farmA", "farmB", "farmC", "farmD", "farmE"];
  const ws = [];
  for (let i = 0; i < bots; i++) ws.push(newWallet({ ageDays: rnd() * 2, txs: Math.floor(rnd() * 8), funder: funders[i % 5] }));
  for (let k = 0; k < 50; k++) {                      // 50 waves of bundled buys + sells (wash)
    const s = slot += 3, t = T0 + rnd() * ROUND;
    for (const w of ws.slice((k * 8) % bots, (k * 8) % bots + 8)) {
      trades.push({ t, slot: s, coin, wallet: w, side: "buy", sol: 2, tokens: 2 * priceTok });
      trades.push({ t: t + 60, slot: s + 2, coin, wallet: w, side: "sell", sol: 1.98, tokens: 2 * priceTok });
    }
  }
  realCommunity(coin, real);
}
// coin C: aged-wallet farm (bought old wallets) - 40 wallets, one funder, buys spread out (harder case)
function agedFarm(coin, n) {
  for (let i = 0; i < n; i++) {
    const w = newWallet({ ageDays: 200, txs: 60, funder: "agedFarmFunder" });
    trades.push({ t: T0 + rnd() * ROUND * 0.9, slot: slot += 11, coin, wallet: w, side: "buy", sol: 0.06, tokens: 0.06 * priceTok });
  }
  realCommunity(coin, 10);
}
realCommunity("CARG", 60); botFarm("CBRA", 400, 15); agedFarm("CFRA", 40); realCommunity("CENG", 25);
const snapT = snapshotTime("future-blockhash-example-123", T0 + ROUND - 12 * 3600, T0 + ROUND);
const sc = scoreRound(trades, wallets, ["CARG", "CBRA", "CFRA", "CENG"], T0, T0 + ROUND, snapT);
console.log("rules", RULES, "\nsnapshot at", new Date(snapT * 1000).toISOString());
console.log("coin   volume SOL   score (qualified holders)   net SOL   excluded");
for (const [c, s] of Object.entries(sc)) console.log(c.padEnd(6), String(s.volumeSol).padStart(10), String(s.score).padStart(15), String(s.netSol).padStart(18), "  ", JSON.stringify(s.excluded));
const byVol = Object.entries(sc).sort((a, b) => b[1].volumeSol - a[1].volumeSol).map((x) => x[0]);
const byScore = Object.entries(sc).sort((a, b) => b[1].score - a[1].score).map((x) => x[0]);
console.log("\nranking by VOLUME   :", byVol.join(" > "), "  <- the bot farm wins");
console.log("ranking by OUR SCORE:", byScore.join(" > "));
console.log("match CARG vs CBRA ->", matchWinner(sc, "CARG", "CBRA"), "| match CFRA vs CENG ->", matchWinner(sc, "CFRA", "CENG"));
const ok = byScore[0] === "CARG" && matchWinner(sc, "CARG", "CBRA") === "CARG" && matchWinner(sc, "CFRA", "CENG") === "CENG";
console.log(ok ? "\nPASS: real communities beat the bot farm and the aged-wallet farm" : "\nFAIL: check the rules");
process.exit(ok ? 0 : 1);
