// Nations Cup scoring (pure functions, no chain access). Score of a coin in a round = number of QUALIFIED BUYERS still holding at the snapshot; tie-breaker = net SOL put in by them.
// Trading volume is deliberately NOT part of the score: bot farms fake it cheaply.
import crypto from "crypto";

export const RULES = {
  minBuySol: 0.05,          // a buyer must buy at least this much SOL of the coin inside the round
  minWalletAgeDays: 7,      // wallet older than this before the round started
  minWalletTxs: 20,         // and with a normal history
  clusterMax: 3,            // more than this many buyers of the same coin funded by the same wallet = a farm: all of them are excluded
  bundleMax: 3,             // more than this many buyers of the same coin in the same slot = a bundle: all of them are excluded
  holdShare: 0.5,           // must still hold at least half of what it bought at the snapshot
};

/** Snapshot time inside [winStart, roundEnd): derived from a block hash that does not exist yet when the round is announced (commit-reveal: the slot number is published in advance). */
export function snapshotTime(blockhash, winStart, roundEnd) {
  const h = crypto.createHash("sha256").update(String(blockhash)).digest();
  const r = h.readUInt32BE(0) / 2 ** 32;
  return Math.floor(winStart + r * (roundEnd - winStart));
}

/**
 * trades: [{t, slot, coin, wallet, side: 'buy'|'sell', sol, tokens}] (all trades of the round's coins, any time)
 * wallets: Map wallet -> {ageDays, txs, funder}
 * returns per coin: {score, netSol, volumeSol, qualified: [...], excluded: {reason: count}}
 */
export function scoreRound(trades, wallets, coins, roundStart, roundEnd, snapT, rules = RULES) {
  const out = {};
  for (const coin of coins) {
    const tr = trades.filter((x) => x.coin === coin);
    const inRound = tr.filter((x) => x.t >= roundStart && x.t < roundEnd);
    const volumeSol = inRound.reduce((s, x) => s + x.sol, 0);
    const buyers = new Map();
    for (const x of inRound) if (x.side === "buy") { const b = buyers.get(x.wallet) || { sol: 0, tokens: 0, slots: new Set() }; b.sol += x.sol; b.tokens += x.tokens; b.slots.add(x.slot); buyers.set(x.wallet, b); }
    const bySlot = new Map(), byFunder = new Map();
    for (const [w, b] of buyers) {
      for (const s of b.slots) bySlot.set(s, (bySlot.get(s) || 0) + 1);
      const f = wallets.get(w)?.funder;
      if (f) byFunder.set(f, (byFunder.get(f) || 0) + 1);
    }
    const excluded = { small: 0, young: 0, cluster: 0, bundle: 0, sold: 0 };
    const qualified = [];
    let netSol = 0;
    for (const [w, b] of buyers) {
      const info = wallets.get(w) || {};
      if (b.sol < rules.minBuySol) { excluded.small++; continue; }
      if ((info.ageDays ?? 0) < rules.minWalletAgeDays || (info.txs ?? 0) < rules.minWalletTxs) { excluded.young++; continue; }
      if (info.funder && byFunder.get(info.funder) > rules.clusterMax) { excluded.cluster++; continue; }
      if ([...b.slots].some((s) => bySlot.get(s) > rules.bundleMax)) { excluded.bundle++; continue; }
      const held = tr.filter((x) => x.wallet === w && x.t < snapT).reduce((s, x) => s + (x.side === "buy" ? x.tokens : -x.tokens), 0);
      if (held < b.tokens * rules.holdShare) { excluded.sold++; continue; }
      const sold = inRound.filter((x) => x.wallet === w && x.side === "sell").reduce((s, x) => s + x.sol, 0);
      netSol += b.sol - sold;
      qualified.push(w);
    }
    out[coin] = { score: qualified.length, netSol: +netSol.toFixed(4), volumeSol: +volumeSol.toFixed(2), qualified, excluded };
  }
  return out;
}

/** winner of a match between two coins */
export function matchWinner(scores, a, b) {
  const A = scores[a], B = scores[b];
  if (A.score !== B.score) return A.score > B.score ? a : b;
  if (A.netSol !== B.netSol) return A.netSol > B.netSol ? a : b;
  return a < b ? a : b; // last resort: deterministic
}
