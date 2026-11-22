// DEVNET ONLY: create the hub token + 32 country coins (1,000,000,000 supply, 6 decimals, Metaplex metadata), then REVOKE mint and freeze authority (nobody can mint more or freeze wallets).
// Uses a throwaway devnet keypair (.devnet-keypair.json, git-ignored). Refuses to run on anything but devnet. Run: node launch.js [--limit N]
import fs from "fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplTokenMetadata, createAndMint, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { generateSigner, keypairIdentity, percentAmount } from "@metaplex-foundation/umi";
import { setAuthority, AuthorityType } from "@metaplex-foundation/mpl-toolbox";
import { HUB, NATIONS } from "./nations.js";

const RPC = "https://api.devnet.solana.com";
if (!RPC.includes("devnet")) throw new Error("devnet only");
const KP = ".devnet-keypair.json", OUT = "out/tokens-devnet.json";
const limit = process.argv.includes("--limit") ? +process.argv[process.argv.indexOf("--limit") + 1] : 99;
fs.mkdirSync("out", { recursive: true });
if (!fs.existsSync(KP)) fs.writeFileSync(KP, JSON.stringify(Array.from(Keypair.generate().secretKey)));
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KP, "utf8")));
const payer = Keypair.fromSecretKey(secret);
const conn = new Connection(RPC, "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureSol(min) {
  for (let i = 0; i < 6; i++) {
    const bal = await conn.getBalance(payer.publicKey);
    console.log("devnet wallet", payer.publicKey.toBase58(), "balance", bal / LAMPORTS_PER_SOL, "SOL");
    if (bal >= min * LAMPORTS_PER_SOL) return true;
    try { const sig = await conn.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, "confirmed"); console.log("airdrop 1 SOL ok"); }
    catch (e) { console.log("airdrop failed:", String(e.message).slice(0, 120)); await sleep(15000); }
  }
  return false;
}

const umi = createUmi(RPC).use(mplTokenMetadata());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
const todo = [HUB, ...NATIONS].filter((t) => !done.some((d) => d.symbol === t.symbol)).slice(0, limit);
if (!(await ensureSol(0.6))) { console.log("not enough devnet SOL (faucet limits). Fund the address above at https://faucet.solana.com and run again."); process.exit(2); }
for (const t of todo) {
  const mint = generateSigner(umi);
  try {
    await createAndMint(umi, { mint, authority: umi.identity, name: t.name, symbol: t.symbol, uri: "", sellerFeeBasisPoints: percentAmount(0), decimals: 6, amount: 1_000_000_000n * 10n ** 6n, tokenOwner: umi.identity.publicKey, tokenStandard: TokenStandard.Fungible }).sendAndConfirm(umi);
    const info = await getMint(conn, new PublicKey(mint.publicKey));
    let b = setAuthority(umi, { owned: mint.publicKey, owner: umi.identity, authorityType: AuthorityType.MintTokens, newAuthority: null });
    if (info.freezeAuthority) b = b.add(setAuthority(umi, { owned: mint.publicKey, owner: umi.identity, authorityType: AuthorityType.FreezeAccount, newAuthority: null }));
    await b.sendAndConfirm(umi);
    const after = await getMint(conn, new PublicKey(mint.publicKey));
    const rec = { symbol: t.symbol, name: t.name, mint: mint.publicKey.toString(), supply: after.supply.toString(), decimals: after.decimals, mintAuthority: after.mintAuthority?.toBase58() ?? null, freezeAuthority: after.freezeAuthority?.toBase58() ?? null };
    done.push(rec);
    fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
    console.log("created", t.symbol.padEnd(6), rec.mint, "| supply", (Number(rec.supply) / 1e6).toLocaleString(), "| mint auth", rec.mintAuthority, "| freeze auth", rec.freezeAuthority);
  } catch (e) { console.log("FAILED", t.symbol, String(e.message).slice(0, 200)); await sleep(3000); }
}
console.log("done:", done.length, "of", NATIONS.length + 1, "tokens; balance left", (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL, "SOL");
