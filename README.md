# ORBIT — Own the financial system.

**The market is a universe.** The Sun is a treasury. Every planet is an asset issued on Robinhood Chain — the brief's NVDA, AAPL, GOLD, TSLA, HOOD, META first, and **anyone may light another**. You do not just hold a token: you choose the planet you orbit, and the Sun pays you in that planet's asset.

The site *is* the solar system. A point of light, the camera pulls back, the system appears. Scroll and you travel planet to planet; hover a planet and it slows; click and the camera enters orbit around it. No cards — labels float like a HUD, sheets have viewfinder ticks, the palette is space black, white, chrome and one discreet gold. Everything on screen is generated at runtime: planet surfaces, the Sun's corona, the stars. No asset is loaded.

## The mechanic

1. **$ORBIT** is launched on Pons V2 with the Sun as its creator-fee recipient (plus a 1% creator tax). Every trade pays the Sun, in ETH.
2. **Anyone lights a planet** — `deployPlanet(asset, priceId)` with 0.01 ETH to the Sun: any 18-decimal token on the chain that no planet pays in yet, with its Pyth feed. Symbol and name are read from the token. The k-th planet lit takes the k-th orbit and locks its orbits (k + 1) × 7 days, at most 91. The sky holds 48 planets. A planet is permanent.
3. Holders park $ORBIT around a planet — as a **satellite** (×1 gravity, ≥ 1,000 ORBIT, leave a day after the last deposit) or as one of its twelve **orbits** (×2 gravity, ≥ 500,000 ORBIT, locked one orbital period, renewed by any deposit; a full leave releases the ring).
4. The Sun **allots** its ETH to the planets in proportion to their **mass** (gravity-weighted $ORBIT). A planet nobody orbits gets nothing; a deserted planet's pending ETH returns to the corona.
5. The **solar wind** turns each planet's ETH into its asset with no DEX in the loop: anyone may deliver the asset and take the pending ETH at Pyth's price plus a discount that ramps 0 → 5% over six hours and resets after every fill. Fills are capped at the pending ETH.
6. The delivered asset is owed to the planet's bodies pro rata to gravity — **harvest** any time. If nobody fills for 30 days, anyone may **vent** the planet's ETH to its bodies as ETH: the oracle is not a single point of failure for the money.

Because flow follows mass and payout follows mass, **every planet yields the same per unit of gravity**. The only choice is what you are paid in.

### Candidates, ghosts, and the catalog

The contract knows nothing about which assets are "right": it lights any 18-decimal token. The site keeps a **catalog** (`src/lib/planets.ts`) of Robinhood stock tokens it verified on chain on 2026-09-18 — the brief's six plus SPY, QQQ, GOOGL, PLTR, MU, INTC, LLY, SNAP, SGOV, SLV — each with the Pyth feed it proposes (24/7 `Equity.Index` where one exists, else market-hours `Equity.US`). Planets whose asset is in the catalog carry a **verified** mark; any other asset is shown **unverified** with its raw address. The brief's six appear in the sky as dark **ghosts on dashed orbits** until someone lights them, each with a one-click "deploy this planet" on its sheet.

**HOOD has no token.** Robinhood has not tokenized its own stock on its own chain (the two "HOOD" contracts there are memecoins with 1M / 1B supply). Its ghost stays dark — "awaiting issuance" — and the day a token exists, anyone lights it from `/deploy` like any other asset. Nothing in the contract needs to change.

## One contract, no owner

[`contracts/contracts/Sun.sol`](contracts/contracts/Sun.sol) — treasury, planets, bodies, wind and vent in one contract. No owner, no admin, no pause, no upgrade. Its address is deterministic: CREATE2 through Arachnid's proxy (`0x4e59…956C`, present on Robinhood Chain) from the exact bytecode the site embeds plus three constructor arguments (Pons factory, Pyth, ETH/USD feed). **Anyone** can put it on chain from `/deploy`, **anyone** can call `launch()` once — Pons' fee plus an optional first buy; only the logo and website are free parameters — and **anyone** lights planets, before or after the launch. Planets are storage, not part of the address.

Predicted address with the current bytecode: `0x39aa28222F836C1Ba2cC298b316948abDcCeC1d4` (any recompile moves it — the site and the scripts always agree because both read `src/lib/abi/Sun.bytecode.json`, written by `hardhat compile`).

### Verified

- **21 unit tests** (`npm run contracts:test`): planets lit by anyone (fee, next orbit, names read off the token, wrong fee / non-token / duplicate / 6-decimal / zero feed / $ORBIT itself refused, the fee allotted to the planets already shining, 48 not 49), launch through the forwarder and the factory, satellites and orbits (minimums, rings, locks, cooldowns, twelve-not-thirteen), allotment by mass, the corona, the wind (price × discount, cap, slippage, stale price, Pyth fee never mistaken for treasury), the vent, equal yield per gravity across planets, the CREATE2 address through the proxy's real code.
- **27 fork checks against the real chain** (`FORK_URL=https://rpc.mainnet.chain.robinhood.com npm run fork:check`, block 66 250 959): the Sun lands at its predicted address through the real proxy and reads Pons' real forwarder and escrow; **planets lit for the real NVDA and GLD tokens** ("NVIDIA • Robinhood Token" read off the token, locks 7 d and 14 d, a duplicate and an EOA refused, fees in the corona); `launch()` goes through the real forwarder with the Sun as the curve's deployer (creator-fee recipient), creator tax 100 bps, launcher exempt from the snipe tax; a stranger's buy leaves 1% base fee on the curve (the 1% creator tax is deducted too and held by the curve until Pons sweeps); bodies with the real $ORBIT; ETH allotted by mass; the real Pyth answers for ETH/USD and reverts `PriceFeedNotFound` for equities not yet pushed on chain; and — with a second Sun built on a mock oracle — a **real, impersonated NVDA holder delivers real NVDA** against the wind and the satellite harvests it: Robinhood's stock token moves through the contract without restriction.
- **Played in the browser** on a seeded mock network (`npm run serve:fork` + the key-less dev wallet): five planets lit by five wallets, **a sixth (SPY) lit from the deploy page** and picked up by the sky and its own `/spy` page, claim an orbit (lock renewed), harvest 0.2283 NVDA, leave 100k of a satellite — chip live, block number, planets with real mass.

### Assumed, not verified

- That Pons credits the creator tax to the fee recipient through the same escrow as the base creator fee, and keeps sweeping after graduation. Both are Pons' behaviour; if they differ, the Sun simply receives less.
- Who really issued a token behind a planet the catalog did not check — the Sun cannot tell a Robinhood stock token from a copy with the same name; the site marks what it verified and shows the address for the rest.
- Whether tokenized stocks may be held by such a contract from a regulatory standpoint. Tokenized stocks are claims on their issuer, not shares. Nothing here is advice.

## Stack

Next 16 (App Router, Turbopack) · React 19 · three.js 0.186 (custom scene, procedural textures, UnrealBloom on capable machines) · Tailwind 4 (tokens only; the HUD is hand-written CSS) · wagmi 2 + viem + RainbowKit · Hardhat 2.29 + OpenZeppelin 5 + Solidity 0.8.28 (via-IR).

## Run it

```bash
npm install && npm --prefix contracts install
npm --prefix contracts run compile      # exports ABI + bytecode into src/lib/abi
npm run dev                             # http://localhost:3571 — the preview sky
```

Rehearse the live state without deploying anything:

```bash
HARDHAT_CHAIN_ID=4663 npm run serve:fork    # mocks; prints NEXT_PUBLIC_SUN + NEXT_PUBLIC_RPC_URL
# put those two lines and NEXT_PUBLIC_DEV_WALLET=1 in .env.local, restart `npm run dev`, then in the console:
# localStorage.setItem("orbit:dev-wallet", JSON.stringify({ rpc: "http://127.0.0.1:8571", address: "<test wallet>" }))
```

Other scripts: `npm run contracts:test`, `npm run fork:check` (needs `FORK_URL`), `npm run capture` (headless-Chrome screenshots with SwiftShader), `npm run logo`.

## Layout

- `src/lib/planets.ts` — the catalog: verified assets, Pyth ids, surfaces, slugs; `surfaceFor()` for unknown assets, `periodForIndex()` / `orbitRadiusFor()` mirroring the contract. Single source for the site **and** the contract scripts.
- `src/lib/system.ts` — the live model: planets dressed from chain data (`dressPlanet`), ghosts for unlit candidates, `resolveKey()` for routes.
- `src/lib/three/` — the sky: `universe.ts` (scene, camera choreography, picking, projection), `textures.ts` (procedural surfaces, corona, environment), `noise.ts`.
- `src/components/sky/` — the fixed canvas and the HUD labels positioned by the frame loop.
- `src/components/home/Journey.tsx` — the scroll journey (one viewport per stage).
- `src/components/planet/`, `src/components/sun/` — the sheets, the wallet actions, `DeployPlanet` (the one button that lights a planet); `src/components/deploy/LightPlanet.tsx` — catalog picker + any-token form with a Hermes feed search.
- `src/lib/preview.ts` — the simulated sky shown while no Sun answers, labelled "preview" everywhere.
- `src/lib/sunDeploy.ts` — the deterministic address and the one deployment transaction.
- `contracts/` — `Sun.sol`, Pons/Pyth interfaces, mocks, tests, `scripts/{deploy,fork-check,serve-fork,probe-tax}.ts`.

## Before mainnet

- Decide who lights the brief's five first — anyone can, from `/deploy` or from each ghost's sheet, 0.01 ETH each; the order fixes their orbits and locks.
- Confirm on the first real trades where Pons credits the creator tax (see `contracts/scripts/probe-tax.ts`).
- Pyth's Hermes needs an API key for fresh updates since 2026-08-26; fillers pass the update with `refuel()`. GLD only has a market-hours feed.
- Set `NEXT_PUBLIC_SITE_URL` so the default logo URL on `/deploy` points at this site; upload the logo to IPFS if Pons' front prefers it.
- Not affiliated with Robinhood, NVIDIA, Apple, Tesla, Meta or State Street.
