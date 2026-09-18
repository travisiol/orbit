"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { usePosition } from "@/hooks/usePosition";
import { sunAbi } from "@/lib/abi/sunAbi";
import { SUN_CONSTANTS } from "@/lib/contracts";
import { explainError } from "@/lib/errors";
import { compact, shortAddress, toNumber } from "@/lib/format";
import { erc20Abi } from "@/lib/ponsAbi";
import { SUN } from "@/lib/sunDeploy";
import type { PlanetState } from "@/lib/system";
import { useSystem } from "@/lib/systemStore";

type Kind = "satellite" | "orbit";

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Enter, leave, harvest — the three things a body can do around a planet.
 * Every transaction is the wallet's own: the Sun has no operator and this
 * component holds no key. Before $ORBIT is launched the controls say so
 * and point at /deploy.
 */
export function PlanetActions({ planet }: { planet: PlanetState }) {
  const idx = planet.idx;
  const system = useSystem();
  const pos = usePosition(idx);
  const displayName = planet.catalog?.name ?? planet.name.replace(/\s*•\s*Robinhood Token\s*$/i, "");
  const periodDays = Math.round(planet.period / 86_400);
  const [kind, setKind] = useState<Kind>("satellite");
  const [amount, setAmount] = useState("");
  const [leaveAmount, setLeaveAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const assetSymbol = planet.symbol;
  // The feed stamps its reads; a clock at most 15 s stale, and pure for the renderer.
  const now = system.updatedAt;
  const p = planet;
  const freeRings = pos.rings ? pos.rings.filter((r) => r === "0x0000000000000000000000000000000000000000").length : 12 - p.orbitsClaimed;
  const myRing = pos.body?.ring ?? 0;

  const parsed = (() => {
    try {
      return amount.trim() ? parseUnits(amount.trim(), 18) : 0n;
    } catch {
      return -1n;
    }
  })();
  const min = kind === "orbit" ? SUN_CONSTANTS.orbitMin : SUN_CONSTANTS.satelliteMin;
  const held = pos.body?.amount ?? 0n;
  const belowMin = parsed >= 0n && parsed + (kind === "orbit" ? held : 0n) < min;
  const tooMuch = parsed > pos.balance;
  const orbitBlocked = kind === "satellite" && myRing !== 0;
  const noRing = kind === "orbit" && myRing === 0 && freeRings === 0;

  async function run(label: string, fn: () => Promise<`0x${string}`>): Promise<boolean> {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      const hash = await fn();
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setDone(label);
      pos.refresh();
      return true;
    } catch (e) {
      setError(explainError(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const enter = async () => {
    if (parsed <= 0n || !system.token) return;
    if (pos.allowance < parsed) {
      const ok = await run("approve", () => writeContractAsync({ address: system.token as Address, abi: erc20Abi, functionName: "approve", args: [SUN, parsed] }));
      if (!ok) return;
    }
    const ok = await run(kind === "orbit" ? "claim orbit" : "launch satellite", () => writeContractAsync({ address: SUN, abi: sunAbi, functionName: "enter", args: [idx, parsed, kind === "orbit"] }));
    if (ok) setAmount("");
  };

  const leave = async () => {
    let v: bigint;
    try {
      v = leaveAmount.trim() ? parseUnits(leaveAmount.trim(), 18) : held;
    } catch {
      return;
    }
    const ok = await run("leave", () => writeContractAsync({ address: SUN, abi: sunAbi, functionName: "leave", args: [idx, v] }));
    if (ok) setLeaveAmount("");
  };

  const harvest = () => run("harvest", () => writeContractAsync({ address: SUN, abi: sunAbi, functionName: "harvest", args: [idx] }));

  if (!system.live || !system.launched) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="note">
          {system.deployed ? (
            <>
              The Sun is on chain but <b>$ORBIT is not launched</b> yet. Anyone can launch it, once, from the deploy page.
            </>
          ) : (
            <>
              Nothing is deployed. The numbers on this sky are a <b>preview simulation</b>. The Sun has a fixed address; anyone can put it on chain and launch $ORBIT from the deploy page.
            </>
          )}
        </p>
        <Link href="/deploy" className="btn" style={{ width: "100%" }}>
          {system.deployed ? "launch $orbit →" : "deploy the sun →"}
        </Link>
      </div>
    );
  }

  if (!pos.address) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="note">Connect a wallet on Robinhood Chain to launch a satellite or claim an orbit here.</p>
        <ConnectButton size="md" full primary />
      </div>
    );
  }

  const lockEnd = now + planet.period;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="seg" role="tablist" aria-label="Kind of body">
        <button type="button" role="tab" aria-selected={kind === "satellite"} data-on={kind === "satellite" ? "1" : "0"} onClick={() => setKind("satellite")}>
          satellite · ×1
        </button>
        <button type="button" role="tab" aria-selected={kind === "orbit"} data-on={kind === "orbit" ? "1" : "0"} onClick={() => setKind("orbit")}>
          orbit · ×2
        </button>
      </div>

      <div className="field">
        <label htmlFor="amount">amount · ORBIT</label>
        <input id="amount" inputMode="decimal" placeholder={kind === "orbit" ? "500000" : "1000"} value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
      </div>

      <p className="note" style={{ margin: 0 }}>
        {kind === "orbit" ? (
          <>
            <b>Orbit.</b> Minimum {compact(toNumber(SUN_CONSTANTS.orbitMin), 0)} ORBIT in total. Locked until <b>{fmtDate(lockEnd)}</b> — one revolution of {displayName} ({periodDays} days), renewed by any further deposit. Twice the gravity of a satellite. {myRing ? <>You hold ring {myRing}.</> : <>{freeRings} of 12 rings free; you take the lowest.</>}
          </>
        ) : (
          <>
            <b>Satellite.</b> Minimum {compact(toNumber(SUN_CONSTANTS.satelliteMin), 0)} ORBIT. Leave any time after a day. Gravity ×1.
          </>
        )}{" "}
        Balance {compact(toNumber(pos.balance), 1)} ORBIT.
      </p>

      {(belowMin || tooMuch || orbitBlocked || noRing) && parsed !== 0n && (
        <p className="note warn" style={{ margin: 0 }}>
          {tooMuch ? "more than your balance." : orbitBlocked ? "you hold an orbit here — deposit as an orbit." : noRing ? "all twelve rings are held; fly as a satellite." : `below the ${kind} minimum.`}
        </p>
      )}

      <button type="button" className="btn btn-primary" style={{ width: "100%" }} disabled={busy !== null || parsed <= 0n || belowMin || tooMuch || orbitBlocked || noRing} onClick={enter}>
        {busy ? `${busy}…` : pos.allowance < parsed && parsed > 0n ? "approve, then enter" : kind === "orbit" ? `claim an orbit of ${displayName}` : `launch a satellite`}
      </button>

      {pos.body && pos.body.amount > 0n && (
        <>
          <div className="rule" style={{ margin: "4px 0" }} />
          <dl className="stat-list">
            <dt>your body</dt>
            <dd>
              {compact(toNumber(pos.body.amount), 2)} ORBIT
              <small>{pos.body.ring ? `orbit · ring ${pos.body.ring}` : "satellite"}</small>
            </dd>
            <dt>{pos.body.ring ? "locked until" : "can leave from"}</dt>
            <dd>{fmtDate(pos.body.ring ? pos.body.lockedUntil : pos.body.since + SUN_CONSTANTS.satelliteCooldownSeconds)}</dd>
            <dt>to harvest</dt>
            <dd>
              {toNumber(pos.body.owedAsset).toFixed(6)} {assetSymbol}
              {pos.body.owedEth > 0n && <small>+ {toNumber(pos.body.owedEth).toFixed(5)} ETH vented</small>}
            </dd>
          </dl>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button type="button" className="btn btn-gold" disabled={busy !== null || (pos.body.owedAsset === 0n && pos.body.owedEth === 0n)} onClick={harvest}>
              harvest
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || (pos.body.ring ? now < pos.body.lockedUntil : now < pos.body.since + SUN_CONSTANTS.satelliteCooldownSeconds)}
              onClick={leave}
              title={leaveAmount ? `leave ${leaveAmount} ORBIT` : "leave everything"}
            >
              leave {leaveAmount ? compact(Number(leaveAmount), 1) : "all"}
            </button>
          </div>
          <div className="field">
            <label htmlFor="leave">leave part · ORBIT (empty = all)</label>
            <input id="leave" inputMode="decimal" placeholder={formatUnits(pos.body.amount, 18)} value={leaveAmount} onChange={(e) => setLeaveAmount(e.target.value)} autoComplete="off" />
          </div>
        </>
      )}

      {pos.rings && p.orbitsClaimed > 0 && (
        <p className="note" style={{ margin: 0 }}>
          rings:{" "}
          {pos.rings.map((r, k) => (r === "0x0000000000000000000000000000000000000000" ? null : <span key={k}>{`${k + 1} ${r.toLowerCase() === pos.address?.toLowerCase() ? "you" : shortAddress(r)} `}</span>))}
        </p>
      )}

      {error && <p className="note err" role="alert" style={{ margin: 0 }}>{error}</p>}
      {done && !error && <p className="note" style={{ margin: 0, color: "var(--up)" }}>{done}: confirmed.</p>}
    </div>
  );
}
