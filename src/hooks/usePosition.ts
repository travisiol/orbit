"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { zeroAddress, type Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { sunAbi } from "@/lib/abi/sunAbi";
import { erc20Abi } from "@/lib/ponsAbi";
import { SUN } from "@/lib/sunDeploy";
import { useSystem } from "@/lib/systemStore";

export type Body = {
  amount: bigint;
  since: number;
  lockedUntil: number;
  ring: number;
  owedAsset: bigint;
  owedEth: bigint;
};

/**
 * The connected wallet's position around one planet, what it can harvest,
 * who holds the planet's rings, and its $ORBIT balance / allowance — one
 * multicall, refreshed every 15 s and after every transaction.
 */
export function usePosition(idx: number) {
  const { address } = useAccount();
  const system = useSystem();
  const enabled = Boolean(address) && system.launched && Boolean(system.token);
  const token = (system.token ?? zeroAddress) as Address;
  const user = (address ?? zeroAddress) as Address;

  const reads = useReadContracts({
    contracts: [
      { address: SUN, abi: sunAbi, functionName: "bodyOf", args: [user, idx] },
      { address: SUN, abi: sunAbi, functionName: "pendingOf", args: [user, idx] },
      { address: SUN, abi: sunAbi, functionName: "rings", args: [idx] },
      { address: token, abi: erc20Abi, functionName: "balanceOf", args: [user] },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [user, SUN] },
    ],
    allowFailure: true,
    query: { enabled, refetchInterval: 15_000 },
  });

  const raw = reads.data;
  const b = raw?.[0]?.result as { amount: bigint; since: bigint; lockedUntil: bigint; ring: number; owedAsset: bigint; owedEth: bigint } | undefined;
  const pending = raw?.[1]?.result as readonly [bigint, bigint] | undefined;
  const body: Body | null = b
    ? { amount: b.amount, since: Number(b.since), lockedUntil: Number(b.lockedUntil), ring: Number(b.ring), owedAsset: pending?.[0] ?? b.owedAsset, owedEth: pending?.[1] ?? b.owedEth }
    : null;
  const rings = (raw?.[2]?.result as readonly Address[] | undefined) ?? null;
  const balance = (raw?.[3]?.result as bigint | undefined) ?? 0n;
  const allowance = (raw?.[4]?.result as bigint | undefined) ?? 0n;

  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void reads.refetch();
    void queryClient.invalidateQueries();
  }, [reads, queryClient]);

  return { address, enabled, body, rings, balance, allowance, refresh, loading: enabled && reads.isPending };
}
