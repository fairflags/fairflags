// DEVNET ONLY: one Meteora DLMM pool per country coin vs SOL, single-sided (coin only), 1% fee, WIDE price range:
// bin step 4% and one extended position of RANGE_BINS bins => the pool can follow the price up to about 1.04^RANGE_BINS (117 bins ~ 100x the start price).
// Stops before the wallet runs out of SOL; resumable (out/pools-devnet.json). Run: node pools-all.js [--only CBRA] [--max N]
import fs from "fs";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const BN = require("bn.js");
const DLMMmod = require("@meteora-ag/dlmm");
const DLMM = DLMMmod.default || DLMMmod;
const { ActivationType, StrategyType, deriveCustomizablePermissionlessLbPair, LBCLMM_PROGRAM_IDS } = DLMMmod;

const BIN_STEP = 400, FEE_BPS = 100, START_MCAP_SOL = 10, RANGE_BINS = 117, DEPOSIT_TOKENS = 900_000_000, MIN_BAL = 0.35;
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const ONLY = arg("--only", null), MAX = +arg("--max", 99);
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(".devnet-keypair.json", "utf8"))));
const tokens = JSON.parse(fs.readFileSync("out/tokens-devnet.json", "utf8")).filter((t) => t.symbol !== "NCUP");
const OUT = "out/pools-devnet.json";
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
const Y = new PublicKey("So11111111111111111111111111111111111111112"), programId = new PublicKey(LBCLMM_PROGRAM_IDS.devnet);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, label) { for (let i = 0; i < 6; i++) { try { return await fn(); } catch (e) { const m = String(e.message || e); if (i === 5 || !/429|Too Many|blockhash|timeout|fetch failed|ECONN/i.test(m)) throw e; console.log("   retry", label, m.slice(0, 80)); await sleep(4000 * (i + 1)); } } }
const bal = async () => (await retry(() => conn.getBalance(payer.publicKey), "balance")) / LAMPORTS_PER_SOL;
const send = (tx, signers, label) => retry(async () => { tx.feePayer = payer.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" }); }, label);

let made = 0;
for (const coin of tokens) {
  if (ONLY && coin.symbol !== ONLY) continue;
  if (done.some((d) => d.symbol === coin.symbol)) continue;
  const X = new PublicKey(coin.mint);
  const [pair] = deriveCustomizablePermissionlessLbPair(X, Y, programId);
  if (await retry(() => conn.getAccountInfo(pair), "pairinfo")) { console.log(coin.symbol, "pool already exists (first prototype pool) - skipped"); continue; }
  const b0 = await bal();
  if (b0 < MIN_BAL) { console.log("STOP: wallet balance", b0, "SOL is below", MIN_BAL, "- request more devnet SOL and run again"); break; }
  if (made >= MAX) break;
  try {
    const activeId = DLMM.getBinIdFromPrice(DLMM.getPricePerLamport(6, 9, START_MCAP_SOL / 1e9), BIN_STEP, true);
    await send(await DLMM.createCustomizablePermissionlessLbPair(conn, new BN(BIN_STEP), X, Y, new BN(activeId), new BN(FEE_BPS), ActivationType.Timestamp, false, payer.publicKey, undefined, false, undefined, undefined, { cluster: "devnet" }), [payer], "create");
    await sleep(1500);
    const dlmm = await retry(() => DLMM.create(conn, pair, { cluster: "devnet" }), "load");
    const pos = Keypair.generate();
    await send(await dlmm.createExtendedEmptyPosition(activeId, activeId + RANGE_BINS - 1, pos.publicKey, payer.publicKey), [payer, pos], "position");
    await sleep(1500);
    const txs = await retry(() => dlmm.addLiquidityByStrategyChunkable({ positionPubKey: pos.publicKey, totalXAmount: new BN(DEPOSIT_TOKENS).mul(new BN(1e6)), totalYAmount: new BN(0),
      strategy: { minBinId: activeId, maxBinId: activeId + RANGE_BINS - 1, strategyType: StrategyType.Spot, singleSidedX: true }, user: payer.publicKey, slippage: 1 }), "liqtx");
    for (const [i, tx] of txs.entries()) { await send(tx, [payer], "liquidity " + (i + 1) + "/" + txs.length); await sleep(800); }
    const b1 = await bal();
    const rec = { symbol: coin.symbol, mint: coin.mint, pair: pair.toBase58(), position: pos.publicKey.toBase58(), binStep: BIN_STEP, feeBps: FEE_BPS, activeId, rangeBins: RANGE_BINS, maxPriceMultiple: +Math.pow(1 + BIN_STEP / 1e4, RANGE_BINS).toFixed(1), depositTokens: DEPOSIT_TOKENS, costSol: +(b0 - b1).toFixed(5) };
    done.push(rec); fs.writeFileSync(OUT, JSON.stringify(done, null, 1)); made++;
    console.log("pool", coin.symbol.padEnd(5), rec.pair, "| range up to", rec.maxPriceMultiple + "x", "| cost", rec.costSol, "SOL | wallet", b1.toFixed(3), "SOL");
  } catch (e) { console.log("FAILED", coin.symbol, String(e.message || e).slice(0, 250)); await sleep(5000); }
  await sleep(2000);
}
console.log("pools done:", done.length, "| wallet", (await bal()).toFixed(3), "SOL");
