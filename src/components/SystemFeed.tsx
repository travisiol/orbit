"use client";

import { useEffect } from "react";
import { zeroAddress, type Address } from "viem";
import { useBlock, useBytecode, useReadContracts } from "wagmi";
import { sunAbi } from "@/lib/abi/sunAbi";
import { PYTH } from "@/lib/contracts";
import { BRIEF, ETH_PRICE_ID } from "@/lib/planets";
import { curveAbi, pythAbi } from "@/lib/ponsAbi";
import { previewSystem } from "@/lib/preview";
import { SUN } from "@/lib/sunDeploy";
import { dressPlanet, ghostsFor, type PlanetChain, type SystemState } from "@/lib/system";
import { systemStore } from "@/lib/systemStore";

function pythToUsd(v: { price: bigint; expo: number } | undefined): number {
  if (!v || v.price <= 0n) return 0;
  return Number(v.price) * 10 ** v.expo;
}

type RawPlanet = {
  asset: Address;
  priceId: `0x${string}`;
  period: number;
  symbol: string;
  name: string;
  deployedBy: Address;
  deployedAt: bigint;
  staked: bigint;
  mass: bigint;
  ethPending: bigint;
  windStart: bigint;
  lastRefuel: bigint;
  bodies: number;
  orbitsClaimed: number;
  assetDelivered: bigint;
};

/**
 * Feeds the system store. Nothing on screen; mounted once in the layout.
 *
 * Until a Sun answers at its deterministic address the store carries the
 * preview simulation, ticked every two seconds so the sky breathes. When
 * the contract exists, every read below replaces it — the planets people
 * have lit, corona, the curve's reserves for the $ORBIT price, Pyth for USD
 * — and the brief's candidates nobody has lit yet become ghosts.
 */
export function SystemFeed() {
  const { data: code } = useBytecode({ address: SUN, query: { refetchInterval: 30_000 } });
  const deployed = Boolean(code && code !== "0x");

  const sunReads = useReadContracts({
    contracts: [
      { address: SUN, abi: sunAbi, functionName: "system" },
      { address: SUN, abi: sunAbi, functionName: "corona" },
      { address: SUN, abi: sunAbi, functionName: "totalPending" },
      { address: SUN, abi: sunAbi, functionName: "orbit" },
      { address: SUN, abi: sunAbi, functionName: "curve" },
      { address: SUN, abi: sunAbi, functionName: "pyth" },
    ],
    allowFailure: false,
    query: { enabled: deployed, refetchInterval: 15_000 },
  });
  const token = (sunReads.data?.[3] as Address | undefined) ?? null;
  const curve = (sunReads.data?.[4] as Address | undefined) ?? null;
  // The oracle the Sun was built with — Pyth on the chain, a mock on a rehearsal network.
  const pyth = (sunReads.data?.[5] as Address | undefined) ?? PYTH;
  const launched = deployed && Boolean(token && token !== zeroAddress && curve && curve !== zeroAddress);
  const planetsRaw = (sunReads.data?.[0] as readonly RawPlanet[] | undefined) ?? [];

  const curveReads = useReadContracts({
    contracts: curve
      ? [
          { address: curve, abi: curveAbi, functionName: "getReserves" },
          { address: curve, abi: curveAbi, functionName: "realQuoteReserve" },
          { address: curve, abi: curveAbi, functionName: "graduationThreshold" },
          { address: curve, abi: curveAbi, functionName: "graduated" },
        ]
      : [],
    allowFailure: true,
    query: { enabled: launched, refetchInterval: 15_000 },
  });

  // One price per lit planet, plus ETH — the list follows whatever planets exist.
  const priceIds = [ETH_PRICE_ID, ...planetsRaw.map((p) => p.priceId)];
  const pythReads = useReadContracts({
    contracts: priceIds.map((id) => ({ address: pyth, abi: pythAbi, functionName: "getPriceUnsafe" as const, args: [id] as const })),
    allowFailure: true,
    query: { enabled: deployed && planetsRaw.length > 0, refetchInterval: 60_000 },
  });

  // The chain's own clock, for locks and cooldowns — a rehearsal network's time is not the wall's.
  const { data: block } = useBlock({ query: { enabled: deployed, refetchInterval: 15_000 } });

  const sunData = sunReads.data;
  const curveData = curveReads.data;
  const pythData = pythReads.data;

  useEffect(() => {
    if (!deployed) {
      const tick = () => systemStore.set({ system: previewSystem(SUN, Math.floor(Date.now() / 1000)) });
      tick();
      const id = setInterval(tick, 2_000);
      return () => clearInterval(id);
    }
    if (!sunData) return;

    const raws = sunData[0] as readonly RawPlanet[];
    const ethUsd = pythToUsd(pythData?.[0]?.result as { price: bigint; expo: number } | undefined);

    const planets = raws.map((raw, idx) => {
      const chain: PlanetChain = {
        asset: raw.asset,
        priceId: raw.priceId,
        period: Number(raw.period),
        symbol: raw.symbol,
        name: raw.name,
        deployedBy: raw.deployedBy,
        deployedAt: Number(raw.deployedAt),
        staked: raw.staked,
        mass: raw.mass,
        bodies: Number(raw.bodies),
        orbitsClaimed: Number(raw.orbitsClaimed),
        ethPending: raw.ethPending,
        windStart: Number(raw.windStart),
        lastRefuel: Number(raw.lastRefuel),
        assetDelivered: raw.assetDelivered,
      };
      return dressPlanet(idx, chain, pythToUsd(pythData?.[idx + 1]?.result as { price: bigint; expo: number } | undefined));
    });

    let orbitPriceEth = 0;
    let graduation = 0;
    let graduated = false;
    if (curveData) {
      const reserves = curveData[0]?.result as readonly [bigint, bigint] | undefined;
      if (reserves && reserves[1] > 0n) orbitPriceEth = Number(reserves[0]) / Number(reserves[1]);
      const real = curveData[1]?.result as bigint | undefined;
      const threshold = curveData[2]?.result as bigint | undefined;
      if (real !== undefined && threshold && threshold > 0n) graduation = Math.min(1, Number(real) / Number(threshold));
      graduated = Boolean(curveData[3]?.result);
    }

    const system: SystemState = {
      deployed: true,
      launched,
      live: true,
      sun: SUN,
      token: launched ? token : null,
      curve: launched ? curve : null,
      pyth,
      planets,
      ghosts: ghostsFor(BRIEF, planets),
      corona: sunData[1] as bigint,
      totalPending: sunData[2] as bigint,
      orbitPriceEth,
      ethUsd,
      graduation,
      graduated,
      blockNumber: block ? Number(block.number) : 0,
      updatedAt: block ? Number(block.timestamp) : Math.floor(Date.now() / 1000),
    };
    systemStore.set({ system });
  }, [deployed, launched, token, curve, pyth, sunData, curveData, pythData, block]);

  return null;
}
