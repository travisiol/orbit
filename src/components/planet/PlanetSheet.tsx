"use client";

import Link from "next/link";
import { explorer } from "@/lib/chain";
import { compact, shortAddress, toNumber, usd } from "@/lib/format";
import { massShare, planetUsd, resolveKey, windDiscountBps, type Ghost, type PlanetState } from "@/lib/system";
import { useSystem } from "@/lib/systemStore";
import { DeployPlanet } from "./DeployPlanet";
import { PlanetActions } from "./PlanetActions";

const fmtDay = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * A body's HUD sheet, found by the key a URL or a journey stage carries. A
 * lit planet shows its numbers and controls; an unlit candidate shows what
 * it would be and the one button that lights it.
 */
export function PlanetSheet({ bodyKey, mode, stop }: { bodyKey: string; mode: "journey" | "focus"; stop?: string }) {
  const system = useSystem();
  const planet = system.planets.find((p) => p.key === bodyKey);
  const ghost = system.ghosts.find((g) => g.key === bodyKey);
  const resolved = planet || ghost ? { planet, ghost } : resolveKey(system, bodyKey);
  if (resolved.planet) return <LitSheet planet={resolved.planet} mode={mode} stop={stop} />;
  if (resolved.ghost) return <GhostSheet ghost={resolved.ghost} mode={mode} stop={stop} />;
  return (
    <aside className="sheet sheet-right" aria-label="No such body">
      <span className="eyebrow">no such planet</span>
      <h2 className="display display-md" style={{ margin: "10px 0 4px" }}>
        {bodyKey}
      </h2>
      <p className="prose" style={{ fontSize: 14 }}>
        Nothing orbits under that name{system.live ? " on this Sun" : " in the preview sky"}. Planets are lit by anyone from the deploy page; the ones lit so far are on the home journey.
      </p>
      <BackLink />
    </aside>
  );
}

function LitSheet({ planet, mode, stop }: { planet: PlanetState; mode: "journey" | "focus"; stop?: string }) {
  const system = useSystem();
  const share = massShare(system, planet.idx);
  const value = planetUsd(system, planet.idx);
  const staked = toNumber(planet.staked);
  const pending = toNumber(planet.ethPending);
  const discount = windDiscountBps(planet);
  const delivered = toNumber(planet.assetDelivered);
  const assetSymbol = planet.symbol;
  const displayName = planet.catalog?.name ?? planet.name.replace(/\s*•\s*Robinhood Token\s*$/i, "");
  const days = Math.round(planet.period / 86_400);

  return (
    <aside className="sheet sheet-right" aria-label={`${displayName} — ${planet.symbol}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span className="eyebrow">{mode === "journey" ? `planet ${stop ?? planet.idx + 1}` : `in orbit · ${planet.symbol}`}</span>
        <span className="eyebrow" style={{ color: share > 0 ? "var(--ink-2)" : undefined }}>
          {`${(share * 100).toFixed(1)}% of the system`}
        </span>
      </div>
      <h2 className="display display-md" style={{ margin: "10px 0 4px" }}>
        {displayName}
      </h2>
      <p className="note" style={{ margin: "0 0 6px" }}>
        Paid in {assetSymbol} · orbit {planet.idx + 1} · orbital period {days} days
      </p>
      <p className="note" style={{ margin: "0 0 16px" }}>
        {planet.verified ? (
          <span style={{ color: "var(--up)" }}>verified · {planet.catalog?.issuer} · robinhood stock token</span>
        ) : (
          <span className="warn">unverified asset — not in the site&apos;s catalog. Check {shortAddress(planet.asset, 6)} yourself before orbiting.</span>
        )}
      </p>

      <dl className="stat-list">
        <dt>in orbit</dt>
        <dd>
          {value > 0 ? usd(value) : "—"}
          <small>{compact(staked, 1)} ORBIT</small>
        </dd>
        <dt>bodies</dt>
        <dd>{planet.bodies.toLocaleString("en-US")}</dd>
        <dt>orbits</dt>
        <dd>
          <span className="rings" style={{ justifyContent: "flex-end" }} aria-label={`${planet.orbitsClaimed} of 12 orbits claimed`}>
            {Array.from({ length: 12 }, (_, k) => (
              <i key={k} data-on={k < planet.orbitsClaimed ? "1" : "0"} />
            ))}
          </span>
        </dd>
        <dt>solar wind</dt>
        <dd>
          {pending > 0 ? `${pending.toFixed(3)} ETH` : "0 ETH"}
          <small>{pending > 0 ? `discount ${(discount / 100).toFixed(2)}%` : "nothing pending"}</small>
        </dd>
        <dt>delivered</dt>
        <dd>
          {delivered > 0 ? `${delivered.toFixed(4)} ${assetSymbol}` : `0 ${assetSymbol}`}
          <small>to date</small>
        </dd>
        {planet.assetUsd > 0 && (
          <>
            <dt>{assetSymbol} price</dt>
            <dd>
              {usd(planet.assetUsd)}
              <small>pyth</small>
            </dd>
          </>
        )}
        <dt>lit by</dt>
        <dd>
          <a href={explorer.address(planet.deployedBy)} target="_blank" rel="noreferrer">
            {shortAddress(planet.deployedBy)}
          </a>
          <small>{planet.deployedAt ? fmtDay(planet.deployedAt) : ""}</small>
        </dd>
      </dl>
      <div className="rule" />
      {mode === "journey" ? (
        <Link href={`/${planet.slug}`} className="btn btn-primary" style={{ width: "100%" }}>
          enter {displayName} →
        </Link>
      ) : (
        <>
          <PlanetActions planet={planet} />
          <p className="note" style={{ marginTop: 14 }}>
            asset{" "}
            <a href={explorer.token(planet.asset)} target="_blank" rel="noreferrer" style={{ color: "var(--ink-2)" }}>
              {shortAddress(planet.asset, 6)}
            </a>
            {" · feed "}
            <span title={planet.priceId}>{planet.priceId.slice(0, 10)}…</span>
          </p>
          <BackLink />
        </>
      )}
    </aside>
  );
}

function GhostSheet({ ghost, mode, stop }: { ghost: Ghost; mode: "journey" | "focus"; stop?: string }) {
  const c = ghost.candidate;
  const days = Math.min(91, 7 * (ghost.slot + 1));
  return (
    <aside className="sheet sheet-right" aria-label={`${c.name} — unlit`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span className="eyebrow">{mode === "journey" ? `candidate ${stop ?? ""}` : `unlit · ${c.symbol}`}</span>
        <span className="eyebrow" style={{ color: "var(--ink-4)" }}>
          {ghost.deployable ? "not deployed" : "no token"}
        </span>
      </div>
      <h2 className="display display-md" style={{ margin: "10px 0 4px" }}>
        {c.name}
      </h2>
      <p className="note" style={{ margin: "0 0 16px" }}>
        {c.line} {ghost.deployable ? `Would take orbit ${ghost.slot + 1}: a ${days}-day lock, paid in ${c.symbol}.` : ""}
      </p>
      {ghost.deployable ? (
        <>
          <dl className="stat-list">
            <dt>asset</dt>
            <dd style={{ textAlign: "left" }}>
              <a href={explorer.token(c.asset)} target="_blank" rel="noreferrer" className="addr">
                {shortAddress(c.asset, 6)}
              </a>
              <small>{c.issuer}</small>
            </dd>
            <dt>pyth feed</dt>
            <dd style={{ textAlign: "left" }}>
              <span title={c.pythId}>{c.pythId.slice(0, 10)}…</span>
              <small>{c.feed}</small>
            </dd>
          </dl>
          <div className="rule" />
          <DeployPlanet candidate={c} slot={ghost.slot} />
        </>
      ) : (
        <>
          <p className="prose" style={{ fontSize: 14, margin: 0 }}>
            Robinhood has not issued a tokenized HOOD on Robinhood Chain (checked 2026-09-18; the two &ldquo;HOOD&rdquo; contracts on the chain are memecoins). The day one exists, anyone lights this planet from the deploy page with its address and its Pyth feed.
          </p>
          <div className="rule" />
          <button type="button" className="btn" disabled style={{ width: "100%" }}>
            awaiting issuance
          </button>
        </>
      )}
      {mode === "focus" && <BackLink />}
    </aside>
  );
}

function BackLink() {
  return (
    <Link href="/" className="eyebrow" style={{ display: "inline-block", marginTop: 18, color: "var(--ink-2)" }}>
      ← back to the system
    </Link>
  );
}
