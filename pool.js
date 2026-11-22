// DEVNET ONLY: one Meteora DLMM pool for a country coin vs SOL, opened SINGLE-SIDED (only the coin is deposited, buyers bring SOL), with a fixed trading fee,
// then a test buy + sell, and the fees the pool position earned. Run: node pool.js [SYMBOL] (default CARG)
import fs from "fs";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const BN = require("bn.js");
const DLMMmod = require("@meteora-ag/dlmm");
const DLMM = DLMMmod.default || DLMMmod;
const { ActivationType, StrategyType, deriveCustomizablePermissionlessLbPair, LBCLMM_PROGRAM_IDS } = DLMMmod;

const RPC = "https://api.devnet.solana.com";
const SYMBOL = process.argv[2] || "CARG";
const BIN_STEP = 100;            // 1% price step between bins
const FEE_BPS = 100;             // 1% trading fee per swap (the fee the organiser's position earns)
const START_MCAP_SOL = 10;       // starting market cap: 10 SOL for 1,000,000,000 tokens
const DEPOSIT_TOKENS = 300_000_000; // tokens put in this first position (one position covers up to ~70 bins = about 2x the start price)
const conn = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(".devnet-keypair.json", "utf8"))));
const coin = JSON.parse(fs.readFileSync("out/tokens-devnet.json", "utf8")).find((t) => t.symbol === SYMBOL);
if (!coin) throw new Error("unknown symbol " + SYMBOL);
const X = new PublicKey(coin.mint), Y = new PublicKey("So11111111111111111111111111111111111111112");
const programId = new PublicKey(LBCLMM_PROGRAM_IDS.devnet);
const bal = async () => (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
const send = async (tx, signers, label) => { tx.feePayer = tx.feePayer || payer.publicKey; const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" }); console.log("  ok", label, sig.slice(0, 20) + "..."); return sig; };
const out = { symbol: SYMBOL, mint: coin.mint, binStep: BIN_STEP, feeBps: FEE_BPS, startMcapSol: START_MCAP_SOL };

const b0 = await bal();
console.log("wallet", payer.publicKey.toBase58(), "balance", b0, "SOL");
const price = START_MCAP_SOL / 1e9;                                    // SOL per token
const activeId = DLMM.getBinIdFromPrice(DLMM.getPricePerLamport(6, 9, price), BIN_STEP, true);
const [pair] = deriveCustomizablePermissionlessLbPair(X, Y, programId);
out.pair = pair.toBase58(); out.activeId = activeId;
console.log("1) create pool", SYMBOL + "/SOL", "fee", FEE_BPS / 100 + "%", "bin step", BIN_STEP / 100 + "%", "start price", price, "SOL/token, active bin", activeId, "pair", out.pair);
if (!(await conn.getAccountInfo(pair))) {
  const tx = await DLMM.createCustomizablePermissionlessLbPair(conn, new BN(BIN_STEP), X, Y, new BN(activeId), new BN(FEE_BPS), ActivationType.Timestamp, false, payer.publicKey, undefined, false, undefined, undefined, { cluster: "devnet" });
  await send(tx, [payer], "pool created");
} else console.log("  pool already exists");
const b1 = await bal(); out.costCreateSol = +(b0 - b1).toFixed(5);
const dlmm = await DLMM.create(conn, pair, { cluster: "devnet" });

console.log("2) add single-sided liquidity:", DEPOSIT_TOKENS.toLocaleString(), SYMBOL, "+ 0 SOL, bins", activeId, "->", activeId + 69);
const pos = Keypair.generate();
const tx2 = await dlmm.initializePositionAndAddLiquidityByStrategy({ positionPubKey: pos.publicKey, totalXAmount: new BN(DEPOSIT_TOKENS).mul(new BN(1e6)), totalYAmount: new BN(0),
  strategy: { minBinId: activeId, maxBinId: activeId + 69, strategyType: StrategyType.Spot, singleSidedX: true }, user: payer.publicKey, slippage: 1 });
await send(tx2, [payer, pos], "liquidity added");
const b2 = await bal(); out.costLiquiditySol = +(b1 - b2).toFixed(5); out.position = pos.publicKey.toBase58();

console.log("3) test BUY with 0.05 SOL");
await dlmm.refetchStates();
let arrs = await dlmm.getBinArrayForSwap(false);
const inBuy = new BN(0.05 * LAMPORTS_PER_SOL);
const qb = dlmm.swapQuote(inBuy, false, new BN(100), arrs);
await send(await dlmm.swap({ inToken: Y, outToken: X, inAmount: inBuy, minOutAmount: qb.minOutAmount, lbPair: dlmm.pubkey, user: payer.publicKey, binArraysPubkey: qb.binArraysPubkey }), [payer], "bought " + (Number(qb.outAmount) / 1e6).toLocaleString() + " " + SYMBOL);
out.buyTokens = Number(qb.outAmount) / 1e6;

console.log("4) test SELL half of it back");
await dlmm.refetchStates();
arrs = await dlmm.getBinArrayForSwap(true);
const inSell = new BN(qb.outAmount.toString()).div(new BN(2));
const qs = dlmm.swapQuote(inSell, true, new BN(100), arrs);
await send(await dlmm.swap({ inToken: X, outToken: Y, inAmount: inSell, minOutAmount: qs.minOutAmount, lbPair: dlmm.pubkey, user: payer.publicKey, binArraysPubkey: qs.binArraysPubkey }), [payer], "sold for " + Number(qs.outAmount) / 1e9 + " SOL");
out.sellSol = Number(qs.outAmount) / 1e9;

console.log("5) fees earned by the pool position");
await dlmm.refetchStates();
const { userPositions } = await dlmm.getPositionsByUserAndLbPair(payer.publicKey);
for (const p of userPositions) {
  const d = p.positionData;
  out.feeTokens = Number(d.feeX.toString()) / 1e6; out.feeSol = Number(d.feeY.toString()) / 1e9;
  console.log("  position", p.publicKey.toBase58(), "| fees: ", out.feeTokens, SYMBOL, "+", out.feeSol, "SOL | tokens in position", Number(d.totalXAmount) / 1e6, "| SOL in position", Number(d.totalYAmount) / 1e9);
}
out.balanceEnd = await bal();
fs.writeFileSync(`out/pool-${SYMBOL}-devnet.json`, JSON.stringify(out, null, 1));
console.log("\ncosts: create pool", out.costCreateSol, "SOL | open position + deposit", out.costLiquiditySol, "SOL (mostly refundable rent) | wallet now", out.balanceEnd, "SOL");
