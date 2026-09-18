"use client";

import Link from "next/link";
import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, useBytecode, usePublicClient, useReadContract, useSendTransaction, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { sunAbi } from "@/lib/abi/sunAbi";
import { explorer } from "@/lib/chain";
import { LAUNCH_FEE_ETH_DISPLAY, PONS_FACTORY } from "@/lib/contracts";
import { explainError } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { factoryAbi } from "@/lib/ponsAbi";
import { site } from "@/lib/site";
import { SUN, sunDeployTx, sunInitCodeHash } from "@/lib/sunDeploy";
import { useSystem } from "@/lib/systemStore";

/**
 * Two transactions, from any wallet, once each: put the Sun on chain at
 * its predicted address, then launch $ORBIT through it. No key of ours is
 * involved at any point.
 */
export function DeploySun() {
  const system = useSystem();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: code, refetch: refetchCode } = useBytecode({ address: SUN, query: { refetchInterval: 20_000 } });
  const deployed = Boolean(code && code !== "0x");
  const { data: launchFee } = useReadContract({ address: PONS_FACTORY, abi: factoryAbi, functionName: "launchFee", query: { refetchInterval: 60_000 } });
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [logo, setLogo] = useState(`${site.url}/orbit-logo.png`);
  const [website, setWebsite] = useState(site.url);
  const [buy, setBuy] = useState("0.05");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fee = launchFee ?? parseEther(LAUNCH_FEE_ETH_DISPLAY);
  const buyWei = (() => {
    try {
      return buy.trim() ? parseEther(buy.trim()) : 0n;
    } catch {
      return -1n;
    }
  })();

  async function deploy() {
    setBusy("deploy");
    setMsg(null);
    try {
      const tx = sunDeployTx();
      const hash = await sendTransactionAsync({ to: tx.to, data: tx.data });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      await refetchCode();
      setMsg({ ok: true, text: `the sun is on chain at ${SUN}.` });
    } catch (e) {
      setMsg({ ok: false, text: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    if (buyWei < 0n) return;
    setBusy("launch");
    setMsg(null);
    try {
      const hash = await writeContractAsync({ address: SUN, abi: sunAbi, functionName: "launch", args: [logo.trim(), website.trim(), buyWei, 0n], value: fee + buyWei });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setMsg({ ok: true, text: "$orbit is launched. the sun is its fee recipient." });
    } catch (e) {
      setMsg({ ok: false, text: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div className="sheet" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <span className="eyebrow">step 1 · the sun</span>
          <span className="eyebrow" style={{ color: deployed ? "var(--up)" : "var(--gold)" }}>
            {deployed ? "on chain" : "not deployed"}
          </span>
        </div>
        <p className="prose" style={{ margin: 0, fontSize: 14 }}>
          One transaction to Arachnid&apos;s proxy carrying the salt and the Sun&apos;s init code. The result lands at{" "}
          <a href={explorer.address(SUN)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--ink)", wordBreak: "break-all" }}>
            {SUN}
          </a>{" "}
          whoever sends it. About 3.3M gas.
        </p>
        <p className="note" style={{ margin: 0, wordBreak: "break-all" }}>
          init code hash {sunInitCodeHash()}
        </p>
        {!address ? <ConnectButton size="md" primary /> : deployed ? null : (
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={deploy}>
            {busy === "deploy" ? "deploying…" : "deploy the sun"}
          </button>
        )}
      </div>

      <div className="sheet" style={{ display: "flex", flexDirection: "column", gap: 14, opacity: deployed ? 1 : 0.55 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <span className="eyebrow">step 2 · $orbit</span>
          <span className="eyebrow" style={{ color: system.launched ? "var(--up)" : "var(--gold)" }}>
            {system.launched ? "launched" : deployed ? "ready" : "after step 1"}
          </span>
        </div>
        {system.launched && system.token ? (
          <p className="prose" style={{ margin: 0, fontSize: 14 }}>
            Token{" "}
            <a href={explorer.token(system.token)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--ink)" }}>
              {system.token}
            </a>
            {" · "}
            <a href={site.ponsTokenUrl(system.token)} target="_blank" rel="noreferrer" style={{ color: "var(--ink)" }}>
              trade on pons
            </a>
          </p>
        ) : (
          <>
            <p className="prose" style={{ margin: 0, fontSize: 14 }}>
              <code>launch()</code> puts ORBIT on Pons V2 with the Sun as creator-fee recipient and a 1% creator tax. Name, ticker and description are fixed in the contract; you choose the logo, the website and a first buy (yours, exempt from the launch snipe tax). Cost: Pons&apos; fee of {toNumber(fee).toFixed(4)} ETH plus the buy.
            </p>
            <div className="field">
              <label htmlFor="logo">logo url</label>
              <input id="logo" value={logo} onChange={(e) => setLogo(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="website">website</label>
              <input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="buy">first buy · eth</label>
              <input id="buy" inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} autoComplete="off" />
            </div>
            {address && (
              <button type="button" className="btn btn-primary" disabled={!deployed || busy !== null || buyWei < 0n} onClick={launch}>
                {busy === "launch" ? "launching…" : `launch $orbit · ${toNumber(fee + (buyWei > 0n ? buyWei : 0n)).toFixed(4)} eth`}
              </button>
            )}
          </>
        )}
      </div>

      {msg && (
        <p className="note" role="status" style={{ color: msg.ok ? "var(--up)" : "var(--down)", margin: 0 }}>
          {msg.text}
        </p>
      )}

      <p className="note" style={{ margin: 0 }}>
        After both steps the sky reads the chain on its own: the preview chip turns live, planets take their real mass, and <Link href="/nvda" style={{ color: "var(--ink-2)" }}>entering a planet</Link> becomes a transaction.
      </p>
    </div>
  );
}
