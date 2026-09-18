"use client";

import { usePathname } from "next/navigation";
import { useSystem } from "@/lib/systemStore";
import { useUi } from "@/lib/ui";

/**
 * Bottom-left, always: whether the numbers on the sky are real. Nothing on
 * the site claims to be live without this chip agreeing.
 */
export function Status() {
  const system = useSystem();
  const intro = useUi((s) => s.intro);
  const pathname = usePathname();
  const shown = intro >= 0.97 || pathname !== "/";
  const [label, tail] = system.live
    ? system.launched
      ? ["live · robinhood chain", system.blockNumber ? ` · block ${system.blockNumber.toLocaleString("en-US")}` : ""]
      : ["sun deployed", " · $orbit not launched yet"]
    : ["preview · simulated sky", " · nothing is launched yet"];
  return (
    <div className="status" style={{ opacity: shown ? 1 : 0, transition: "opacity 700ms ease" }}>
      <span className="chip" data-live={system.live ? "1" : "0"} title={system.live ? "Numbers read from the Sun contract." : "A simulation of what the system could look like three weeks after launch. No contract is deployed."}>
        <span className="dot" />
        {label}
        <span className="hide-sm">{tail}</span>
      </span>
    </div>
  );
}
