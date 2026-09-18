"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { sunAbi } from "@/lib/abi/sunAbi";
import { SUN_CONSTANTS } from "@/lib/contracts";
import { explainError } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import type { Candidate } from "@/lib/planets";
import { SUN } from "@/lib/sunDeploy";
import { useSystem } from "@/lib/systemStore";

/**
 * The one button that lights a planet: `deployPlanet(asset, priceId)` with
 * the fee, from the connected wallet. Used on a candidate's sheet (the
 * catalog fills the fields) and on the deploy page (any asset).
 */
export function DeployPlanet({ candidate, asset, pythId, symbol, slot, onDone }: { candidate?: Candidate; asset?: Address; pythId?: Hex; symbol?: string; slot?: number; onDone?: (idx: number) => void }) {
  const system = useSystem();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const a = (candidate?.asset ?? asset) as Address | undefined;
  const id = (candidate?.pythId ?? pythId) as Hex | undefined;
  const sym = candidate?.symbol ?? symbol ?? "this asset";
  const fee = SUN_CONSTANTS.planetFee;
  const full = system.planets.length >= SUN_CONSTANTS.maxPlanets;

  async function deploy() {
    if (!a || !id) return;
    setBusy(true);
    setMsg(null);
    try {
      const hash = await writeContractAsync({ address: SUN, abi: sunAbi, functionName: "deployPlanet", args: [a, id], value: fee });
      const receipt = publicClient ? await publicClient.waitForTransactionReceipt({ hash }) : null;
      void receipt;
      await queryClient.invalidateQueries();
      setMsg({ ok: true, text: `${sym} is lit. it takes orbit ${(slot ?? system.planets.length) + 1}; the sky picks it up within a few seconds.` });
      onDone?.(slot ?? system.planets.length);
    } catch (e) {
      setMsg({ ok: false, text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!system.deployed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="note" style={{ margin: 0 }}>
          {system.live ? "" : "This is the preview sky. "}The Sun is not on chain yet; planets are lit on it, so it comes first.
        </p>
        <Link href="/deploy" className="btn" style={{ width: "100%" }}>
          deploy the sun →
        </Link>
      </div>
    );
  }
  if (!address) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="note" style={{ margin: 0 }}>
          Anyone may light {sym}: one transaction, {toNumber(fee).toFixed(2)} ETH to the Sun plus gas. Connect a wallet on Robinhood Chain.
        </p>
        <ConnectButton size="md" full primary />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button type="button" className="btn btn-primary" style={{ width: "100%" }} disabled={busy || !a || !id || full} onClick={deploy}>
        {busy ? "lighting…" : full ? "the sky is full (48 planets)" : `deploy this planet · ${toNumber(fee).toFixed(2)} eth`}
      </button>
      <p className="note" style={{ margin: 0 }}>
        The fee goes to the Sun&apos;s corona and is allotted to the planets already shining. The symbol and name are read from the token; the planet is permanent.
      </p>
      {msg && (
        <p className="note" role="status" style={{ margin: 0, color: msg.ok ? "var(--up)" : "var(--down)" }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
