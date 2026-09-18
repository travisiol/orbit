"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { sunAbi } from "@/lib/abi/sunAbi";
import { explorer } from "@/lib/chain";
import { PONS_FEE_ESCROW, SUN_CONSTANTS } from "@/lib/contracts";
import { explainError } from "@/lib/errors";
import { shortAddress, toNumber, usd } from "@/lib/format";
import { escrowAbi } from "@/lib/ponsAbi";
import { site } from "@/lib/site";
import { SUN } from "@/lib/sunDeploy";
import { massShare, systemUsd, totalBodies } from "@/lib/system";
import { useSystem } from "@/lib/systemStore";

/**
 * The Sun's HUD sheet: what the treasury holds, where it is going, and the
 * two permissionless levers anyone may pull — collect the fees Pons has
 * swept to its escrow, and ignite (allot) what the Sun holds to the planets.
 */
export function SunSheet({ mode }: { mode: "journey" | "focus" }) {
  const system = useSystem();
  const eth = toNumber(system.corona + system.totalPending);
  const corona = toNumber(system.corona);
  const pending = toNumber(system.totalPending);
  const { data: escrowBalance } = useReadContract({
    address: PONS_FEE_ESCROW,
    abi: escrowAbi,
    functionName: "balanceOf",
    args: [SUN],
    query: { enabled: system.live, refetchInterval: 20_000 },
  });
  const inEscrow = escrowBalance ? toNumber(escrowBalance) : 0;

  return (
    <aside className="sheet sheet-right" aria-label="The Sun — treasury">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span className="eyebrow" style={{ color: "var(--gold)" }}>
          the sun · treasury
        </span>
        <span className="eyebrow">{system.live ? (system.launched ? "live" : "not launched") : "preview"}</span>
      </div>
      <h2 className="display display-md" style={{ margin: "10px 0 4px" }}>
        {eth > 0 ? `${eth.toFixed(4)} ETH` : "0 ETH"}
      </h2>
      <p className="note" style={{ margin: "0 0 16px" }}>
        Every trade of ${site.ticker} pays creator fees to the Sun — Pons&apos; creator share of the 1% base fee plus a {SUN_CONSTANTS.creatorTaxBps / 100}% creator tax. The Sun keeps nothing: it allots by mass, the wind converts, the planets pay.
      </p>

      <dl className="stat-list">
        <dt>corona</dt>
        <dd>
          {corona.toFixed(4)} ETH
          <small>unallotted</small>
        </dd>
        <dt>pending</dt>
        <dd>
          {pending.toFixed(4)} ETH
          <small>on the planets</small>
        </dd>
        {system.live && (
          <>
            <dt>in escrow</dt>
            <dd>
              {inEscrow.toFixed(4)} ETH
              <small>at pons, claimable</small>
            </dd>
          </>
        )}
        <dt>in orbit</dt>
        <dd>
          {usd(systemUsd(system))}
          <small>{totalBodies(system).toLocaleString("en-US")} bodies</small>
        </dd>
        {system.launched && system.orbitPriceEth > 0 && (
          <>
            <dt>${site.ticker}</dt>
            <dd>
              {(system.orbitPriceEth * system.ethUsd).toFixed(6) !== "0.000000" ? usd(system.orbitPriceEth * system.ethUsd) : `${system.orbitPriceEth.toExponential(2)} ETH`}
              <small>{system.graduated ? "graduated" : `${Math.round(system.graduation * 100)}% to graduation`}</small>
            </dd>
          </>
        )}
      </dl>

      <div className="rule" />
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        allotment by mass
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {system.planets.length === 0 && <p className="note" style={{ margin: 0 }}>No planet is lit yet. The corona waits for the first.</p>}
        {system.planets.map((p) => {
          const share = massShare(system, p.idx);
          return (
            <div key={p.key} style={{ display: "grid", gridTemplateColumns: "52px 1fr 52px", alignItems: "center", gap: 10 }} className="mono">
              <span style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis" }}>{p.symbol}</span>
              <span style={{ height: 2, background: "var(--ink-4)", position: "relative" }}>
                <span style={{ position: "absolute", inset: 0, width: `${Math.max(0, share * 100)}%`, background: p.surface === "gold" ? "var(--gold)" : "var(--ink)" }} />
              </span>
              <span style={{ fontSize: 11, textAlign: "right", color: "var(--ink-2)" }}>{`${(share * 100).toFixed(1)}%`}</span>
            </div>
          );
        })}
        {system.ghosts.map((g) => (
          <div key={g.key} style={{ display: "grid", gridTemplateColumns: "52px 1fr 52px", alignItems: "center", gap: 10 }} className="mono">
            <span style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-4)" }}>{g.candidate.symbol}</span>
            <span style={{ height: 2, background: "var(--ink-4)", opacity: 0.5 }} />
            <span style={{ fontSize: 11, textAlign: "right", color: "var(--ink-4)" }}>{g.deployable ? "unlit" : "dark"}</span>
          </div>
        ))}
      </div>

      <div className="rule" />
      {mode === "journey" ? (
        <Link href="/sun" className="btn" style={{ width: "100%" }}>
          open the sun →
        </Link>
      ) : (
        <SunLevers inEscrow={inEscrow} />
      )}
      <p className="note" style={{ marginTop: 14 }}>
        sun{" "}
        <a href={explorer.address(SUN)} target="_blank" rel="noreferrer" style={{ color: "var(--ink-2)" }}>
          {shortAddress(SUN, 6)}
        </a>
        {system.token && (
          <>
            {" · "}
            <a href={site.ponsTokenUrl(system.token)} target="_blank" rel="noreferrer" style={{ color: "var(--ink-2)" }}>
              trade ${site.ticker} on pons
            </a>
          </>
        )}
      </p>
      {mode === "focus" && (
        <Link href="/" className="eyebrow" style={{ display: "inline-block", marginTop: 8, color: "var(--ink-2)" }}>
          ← back to the system
        </Link>
      )}
    </aside>
  );
}

function SunLevers({ inEscrow }: { inEscrow: number }) {
  const system = useSystem();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(label: string, fn: "collect" | "ignite") {
    setBusy(label);
    setMsg(null);
    try {
      const hash = await writeContractAsync({ address: SUN, abi: sunAbi, functionName: fn });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`${label}: confirmed.`);
    } catch (e) {
      setMsg(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  if (!system.live) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="note" style={{ margin: 0 }}>
          The Sun is not deployed. Its address is fixed in advance; anyone can put it on chain.
        </p>
        <Link href="/deploy" className="btn" style={{ width: "100%" }}>
          deploy the sun →
        </Link>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button type="button" className="btn btn-gold" disabled={!address || busy !== null || inEscrow === 0} onClick={() => run("collect", "collect")} title="Pull the creator fees Pons has swept to its escrow, then allot them">
          {busy === "collect" ? "collecting…" : "collect fees"}
        </button>
        <button type="button" className="btn" disabled={!address || busy !== null || system.corona === 0n} onClick={() => run("ignite", "ignite")} title="Allot the corona to the planets by mass">
          {busy === "ignite" ? "igniting…" : "ignite"}
        </button>
      </div>
      <p className="note" style={{ margin: 0 }}>
        Both are permissionless and happen on their own at every enter, leave, harvest or fill; these buttons just let anyone hurry them. {!address && "Connect a wallet to press them."}
      </p>
      {msg && (
        <p className="note" style={{ margin: 0, color: msg.endsWith("confirmed.") ? "var(--up)" : "var(--down)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
