"use client";

import Link from "next/link";
import type { Ref } from "react";
import { toNumber, usd } from "@/lib/format";
import { planetUsd, systemUsd, totalBodies, type Ghost, type PlanetState } from "@/lib/system";
import { useSystem } from "@/lib/systemStore";
import { useUi } from "@/lib/ui";

/**
 * The HUD label next to a body: ticker, dollars parked around it, bodies.
 * Positioned by the frame loop (Sky.tsx) through the ref; only the text is
 * React's.
 */
export function PlanetLabel({ planet, ref }: { planet: PlanetState; ref: Ref<HTMLDivElement> }) {
  const system = useSystem();
  const hover = useUi((s) => s.hover);
  const value = planetUsd(system, planet.idx);
  return (
    <div ref={ref} className="hud-label" data-hover={hover === planet.key ? "1" : undefined} data-unverified={planet.verified ? undefined : "1"}>
      <Link href={`/${planet.slug}`} className="hud-label-inner" prefetch={false}>
        <span className="hud-label-symbol">{planet.symbol}</span>
        <span className="hud-label-value">{value > 0 ? usd(value) : system.live ? "$0" : "—"}</span>
        <span className="hud-label-meta">
          {planet.bodies.toLocaleString("en-US")} {planet.bodies === 1 ? "holder" : "holders"}
          {planet.verified ? "" : " · unverified"}
        </span>
      </Link>
    </div>
  );
}

/** A candidate nobody has lit: the label says so, and offers the deploy. */
export function GhostLabel({ ghost, ref }: { ghost: Ghost; ref: Ref<HTMLDivElement> }) {
  const hover = useUi((s) => s.hover);
  return (
    <div ref={ref} className="hud-label" data-hover={hover === ghost.key ? "1" : undefined} data-dark="1">
      <Link href={`/${ghost.candidate.slug}`} className="hud-label-inner" prefetch={false}>
        <span className="hud-label-symbol">{ghost.candidate.symbol}</span>
        <span className="hud-label-value">{ghost.deployable ? "unlit" : "no token"}</span>
        <span className="hud-label-meta">{ghost.deployable ? "deploy this planet →" : "awaiting issuance"}</span>
      </Link>
    </div>
  );
}

export function SunLabel({ ref }: { ref: Ref<HTMLDivElement> }) {
  const system = useSystem();
  const eth = toNumber(system.corona + system.totalPending);
  return (
    <div ref={ref} className="hud-label hud-label-sun">
      <Link href="/sun" className="hud-label-inner" prefetch={false}>
        <span className="hud-label-symbol">SUN</span>
        <span className="hud-label-value">{eth > 0 ? `${eth.toFixed(3)} ETH` : "0 ETH"}</span>
        <span className="hud-label-meta">
          treasury · {usd(systemUsd(system))} in orbit · {totalBodies(system).toLocaleString("en-US")} bodies
        </span>
      </Link>
    </div>
  );
}
