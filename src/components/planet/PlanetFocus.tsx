"use client";

import { useEffect } from "react";
import { PlanetSheet } from "@/components/planet/PlanetSheet";
import { resolveKey } from "@/lib/system";
import { useSystem } from "@/lib/systemStore";
import { uiStore } from "@/lib/ui";

/**
 * One body, in focus. The route key resolves against the live system —
 * lit planets by slug, symbol or `p<index>`, candidates by slug — so a
 * planet lit a minute ago already has a page. The camera enters orbit
 * around whatever the key names; the sheet takes the right edge.
 */
export function PlanetFocus({ routeKey }: { routeKey: string }) {
  const system = useSystem();
  const { planet, ghost } = resolveKey(system, routeKey);
  const bodyKey = planet?.key ?? ghost?.key ?? null;

  useEffect(() => {
    uiStore.set({ focus: bodyKey ? { kind: "planet", key: bodyKey } : { kind: "none" } });
  }, [bodyKey]);

  return (
    <div className="frame">
      <PlanetSheet bodyKey={bodyKey ?? routeKey} mode="focus" />
    </div>
  );
}
