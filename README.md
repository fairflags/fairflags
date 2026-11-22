# FairFlags (devnet prototype)

32 countries. One bracket. Real people count, bots don't.

FairFlags is a country-vs-country tournament on Solana. Each country is a community coin. Matches are decided by how many **real people** hold a country's coin at a random moment, **not by trading volume** (volume is cheap to fake).

**Status: devnet prototype only. No token is live. There is no presale.** Website: https://fairflags.pages.dev

## How scoring works (`scorer.js`)
At a random snapshot time, a holder counts for a country only if all of these are true:

| Rule | Default |
|---|---|
| Bought at least | 0.05 SOL |
| Wallet age | at least 7 days |
| Wallet history | at least 20 transactions |
| Same-funder cluster | more than 3 buyers funded by one wallet → all excluded |
| Bundled buys | more than 3 buys in one block → excluded |
| Still holding | at least 50% of what they bought |

The score is the number of holders that pass. Volume is shown but never counted.

## Check it yourself
```
npm install
node sim.js
```
`sim.js` runs a simulated match: a bot farm with 29x the volume of a real community, plus an aged-wallet farm. The scoring ranks the real communities first (expected output ends with `PASS`).

## Files
- `scorer.js`: the scoring rules
- `indexer.js`: reads pool trades from devnet and builds the scoreboard
- `sim.js`: bot-farm simulation
- `launch.js`, `pool.js`, `pools-all.js`: devnet test coins and pools (devnet only; they refuse other networks)
- `server.js`, `scoreboard.html`: the scoreboard page
- `out/tokens-devnet.json`: the devnet test coins (mint and freeze authority revoked)

## Official links (only these)
- X: https://x.com/FairFlags
- Telegram: https://t.me/fairflags

We never DM first and never ask for a seed phrase. Nothing here is financial advice.

## Licence
MIT. Free to use, copy and change; keep the licence notice. See LICENSE.
