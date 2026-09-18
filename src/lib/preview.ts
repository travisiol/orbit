import type { Address } from "viem";
import { BRIEF, periodForIndex, ZERO_ADDRESS } from "./planets";
import { dressPlanet, emptySystem, ghostsFor, type SystemState } from "./system";

/**
 * The preview sky: what the system could look like three weeks after
 * launch, with the brief's planets lit in the brief's order. It is a
 * simulation — labelled as such everywhere it shows — that runs so the site
 * is not a black screen with zeros on it before the Sun exists. The moment
 * a Sun answers on chain, the feed replaces it and nothing here is shown
 * again.
 *
 * Every number is generated from a fixed seed plus a slow, bounded drift,
 * so the first paint is identical on server and client and the sky still
 * breathes afterwards.
 */

const WEI = 10n ** 18n;
const wei = (whole: number) => BigInt(Math.round(whole * 1e6)) * (WEI / 1_000_000n);

type Seed = { staked: number; bodies: number; orbits: number; pendingEth: number; delivered: number; assetUsd: number };

/** The brief's own example — NVDA $18,429, 421 holders — is the anchor. */
const SEEDS: Record<string, Seed> = {
  NVDA: { staked: 24_100_000, bodies: 421, orbits: 9, pendingEth: 0.412, delivered: 4.81, assetUsd: 181 },
  AAPL: { staked: 14_210_000, bodies: 233, orbits: 6, pendingEth: 0.226, delivered: 3.05, assetUsd: 254 },
  GLD: { staked: 19_800_000, bodies: 188, orbits: 12, pendingEth: 0.309, delivered: 6.28, assetUsd: 372 },
  TSLA: { staked: 9_640_000, bodies: 302, orbits: 7, pendingEth: 0.184, delivered: 1.92, assetUsd: 412 },
  META: { staked: 6_120_000, bodies: 141, orbits: 4, pendingEth: 0.071, delivered: 0.64, assetUsd: 738 },
};

const ETH_USD = 2_452;
/** $18,429 / 24.1M ORBIT ≈ $0.000765 per ORBIT. */
const ORBIT_USD = 18_429 / 24_100_000;
const PREVIEW_DEPLOYER = "0x0000000000000000000000000000000000000f1e" as Address;

export function previewSystem(sun: Address, at = 0): SystemState {
  const base = emptySystem(sun);
  const now = at || 1_789_000_000; // a fixed instant for the first paint
  const lit = BRIEF.filter((c) => c.asset !== ZERO_ADDRESS);
  const planets = lit.map((c, idx) => {
    const s = SEEDS[c.symbol];
    // Slow, bounded breathing: ±0.6% over ~11 minutes plus a per-planet phase.
    const phase = idx * 1.7;
    const breathe = 1 + 0.006 * Math.sin(now / 660 + phase) + 0.002 * Math.sin(now / 97 + phase * 3);
    const staked = wei(s.staked * breathe);
    // Orbits weigh twice; each orbit holds ~2% of the planet's stake in this sky.
    const orbitStake = (staked * BigInt(Math.min(s.orbits * 2, 60))) / 100n;
    const mass = staked + orbitStake;
    const cycle = 6 * 3600;
    const windStart = now - ((now + idx * 1_913) % cycle);
    const pending = wei(s.pendingEth * (0.35 + 0.65 * ((now - windStart) / cycle)));
    return dressPlanet(
      idx,
      {
        asset: c.asset,
        priceId: c.pythId,
        period: periodForIndex(idx),
        symbol: c.symbol,
        name: `${c.name} • Robinhood Token`,
        deployedBy: PREVIEW_DEPLOYER,
        deployedAt: now - 21 * 86_400 + idx * 3_600,
        staked,
        mass,
        bodies: s.bodies + Math.floor((now / 3600 + idx * 3) % 5),
        orbitsClaimed: s.orbits,
        ethPending: pending,
        windStart,
        lastRefuel: windStart - 1_200,
        assetDelivered: wei(s.delivered + (now % 100_000) / 4e6),
      },
      s.assetUsd,
    );
  });
  const totalPending = planets.reduce((a, p) => a + p.ethPending, 0n);
  return {
    ...base,
    live: false,
    deployed: false,
    launched: false,
    planets,
    ghosts: ghostsFor(BRIEF, planets),
    corona: wei(0.0412 + 0.01 * Math.sin(now / 300)),
    totalPending,
    orbitPriceEth: ORBIT_USD / ETH_USD,
    ethUsd: ETH_USD,
    graduation: 0.61,
    graduated: false,
    blockNumber: 0,
    updatedAt: now,
  };
}
