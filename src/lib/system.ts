import type { Address } from "viem";
import { candidateByAsset, orbitRadiusFor, surfaceFor, ZERO_ADDRESS, type Candidate, type Surface } from "./planets";

/**
 * One lit planet, as the Sun reports it plus what the screen needs. The
 * catalog match (if any) gives it a look and a "verified" mark; an unknown
 * asset gets a surface from its address and no mark.
 */
export type PlanetState = {
  /** Index in the Sun — also its orbit: the k-th planet lit sits on the k-th orbit. */
  idx: number;
  key: string;
  asset: Address;
  priceId: `0x${string}`;
  symbol: string;
  name: string;
  /** Orbital period in seconds — the lock of an orbit. */
  period: number;
  deployedBy: Address;
  deployedAt: number;
  /** In the catalog: the asset was checked by the site. */
  verified: boolean;
  catalog: Candidate | null;
  slug: string;
  surface: Surface;
  orbitRadius: number;
  /** Raw $ORBIT parked around the planet, wei. */
  staked: bigint;
  /** Gravity-weighted $ORBIT, wei. */
  mass: bigint;
  bodies: number;
  orbitsClaimed: number;
  ethPending: bigint;
  windStart: number;
  lastRefuel: number;
  assetDelivered: bigint;
  /** USD per unit of the planet's asset (0 = unknown). */
  assetUsd: number;
};

/** A catalog entry nobody has lit yet: a dark body on a dashed orbit past the last planet. */
export type Ghost = {
  key: string;
  candidate: Candidate;
  /** Orbit index it would take if lit next (display only). */
  slot: number;
  orbitRadius: number;
  /** false for HOOD: no token exists to light it with. */
  deployable: boolean;
};

export type SystemState = {
  /** True when a Sun answers at its address. */
  deployed: boolean;
  /** True when $ORBIT has been launched through it. */
  launched: boolean;
  /** False while the numbers are the preview simulation. */
  live: boolean;
  sun: Address;
  token: Address | null;
  curve: Address | null;
  pyth: Address | null;
  planets: PlanetState[];
  ghosts: Ghost[];
  /** ETH the Sun holds that no planet has been allotted yet. */
  corona: bigint;
  totalPending: bigint;
  /** ETH per whole $ORBIT, from the curve's reserves. */
  orbitPriceEth: number;
  ethUsd: number;
  /** Curve progress to graduation, 0–1. */
  graduation: number;
  graduated: boolean;
  blockNumber: number;
  updatedAt: number;
};

export type PlanetChain = {
  asset: Address;
  priceId: `0x${string}`;
  period: number;
  symbol: string;
  name: string;
  deployedBy: Address;
  deployedAt: number;
  staked: bigint;
  mass: bigint;
  bodies: number;
  orbitsClaimed: number;
  ethPending: bigint;
  windStart: number;
  lastRefuel: number;
  assetDelivered: bigint;
};

/** Dress a planet read from the chain with its look and its slug. */
export function dressPlanet(idx: number, raw: PlanetChain, assetUsd: number): PlanetState {
  const catalog = candidateByAsset(raw.asset) ?? null;
  return {
    idx,
    key: `planet:${raw.asset.toLowerCase()}`,
    ...raw,
    verified: catalog !== null,
    catalog,
    slug: catalog?.slug ?? (raw.symbol ? raw.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-") : `p${idx}`),
    surface: catalog?.surface ?? surfaceFor(raw.asset),
    orbitRadius: orbitRadiusFor(idx),
    assetUsd,
  };
}

/** The candidates that are not lit, as ghosts on the orbits past the last planet. */
export function ghostsFor(candidates: readonly Candidate[], planets: PlanetState[]): Ghost[] {
  const lit = new Set(planets.map((p) => p.asset.toLowerCase()));
  const out: Ghost[] = [];
  for (const c of candidates) {
    if (c.asset !== ZERO_ADDRESS && lit.has(c.asset.toLowerCase())) continue;
    const slot = planets.length + out.length;
    out.push({ key: `ghost:${c.slug}`, candidate: c, slot, orbitRadius: orbitRadiusFor(slot), deployable: c.asset !== ZERO_ADDRESS });
  }
  return out;
}

export function emptySystem(sun: Address): SystemState {
  return {
    deployed: false,
    launched: false,
    live: false,
    sun,
    token: null,
    curve: null,
    pyth: null,
    planets: [],
    ghosts: [],
    corona: 0n,
    totalPending: 0n,
    orbitPriceEth: 0,
    ethUsd: 0,
    graduation: 0,
    graduated: false,
    blockNumber: 0,
    updatedAt: 0,
  };
}

const WEI = 1e18;

export function totalMass(s: SystemState): bigint {
  return s.planets.reduce((acc, p) => acc + p.mass, 0n);
}

/** The planet's share of the system's gravity, 0–1. */
export function massShare(s: SystemState, idx: number): number {
  const total = totalMass(s);
  const p = s.planets[idx];
  if (!p || total === 0n) return 0;
  return Number((p.mass * 1_000_000n) / total) / 1_000_000;
}

/** USD value of the $ORBIT parked around a planet. */
export function planetUsd(s: SystemState, idx: number): number {
  const p = s.planets[idx];
  if (!p) return 0;
  return (Number(p.staked) / WEI) * s.orbitPriceEth * s.ethUsd;
}

export function systemUsd(s: SystemState): number {
  return s.planets.reduce((acc, _p, i) => acc + planetUsd(s, i), 0);
}

export function totalBodies(s: SystemState): number {
  return s.planets.reduce((acc, p) => acc + p.bodies, 0);
}

/** Farthest orbit drawn, planets and ghosts included — the wide view frames it. */
export function outerRadius(s: SystemState): number {
  let r = orbitRadiusFor(4);
  for (const p of s.planets) r = Math.max(r, p.orbitRadius);
  for (const g of s.ghosts) r = Math.max(r, g.orbitRadius);
  return r;
}

/** The wind's discount right now, in bps, mirroring Sun.windDiscountBps. */
export function windDiscountBps(p: PlanetState, now = Date.now() / 1000): number {
  if (p.ethPending === 0n || p.windStart === 0) return 0;
  const elapsed = Math.max(0, now - p.windStart);
  const ramp = 6 * 3600;
  if (elapsed >= ramp) return 500;
  return Math.floor((500 * elapsed) / ramp);
}

/** Find a planet or a ghost by the key a URL carries: catalog slug, on-chain symbol, `p<idx>`. */
export function resolveKey(s: SystemState, key: string): { planet?: PlanetState; ghost?: Ghost } {
  const k = key.toLowerCase();
  const byIdx = /^p(\d+)$/.exec(k);
  if (byIdx) {
    const planet = s.planets[Number(byIdx[1])];
    return planet ? { planet } : {};
  }
  const planet = s.planets.find((p) => p.slug === k || p.symbol.toLowerCase() === k || p.asset.toLowerCase() === k);
  if (planet) return { planet };
  const ghost = s.ghosts.find((g) => g.candidate.slug === k || g.candidate.symbol.toLowerCase() === k);
  return ghost ? { ghost } : {};
}
