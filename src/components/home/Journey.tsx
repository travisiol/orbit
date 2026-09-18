"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PlanetSheet } from "@/components/planet/PlanetSheet";
import { SunSheet } from "@/components/sun/SunSheet";
import { explorer } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { site } from "@/lib/site";
import { SUN } from "@/lib/sunDeploy";
import { useSystem } from "@/lib/systemStore";
import { stagePresence, stagesFor, uiStore, useUi } from "@/lib/ui";

/**
 * The home is one long scroll over a fixed sky. Each viewport of scroll is
 * a stage: the wide system, every planet people have lit from the innermost
 * out, the candidates nobody has lit, the Sun, how it works, the end. The
 * camera travels (lib/three/universe.ts reads `progress`); this component
 * only fades the words in and out. Light a planet and the scroll grows a
 * stop.
 *
 * The scrollbar's position is only a target: the frame loop glides
 * `progress` toward it, so a mouse wheel's notches become one continuous
 * travel instead of a lurch per notch — and the camera, which eases toward
 * the eased progress, never jumps.
 */
export function Journey() {
  const progress = useUi((s) => s.progress);
  const intro = useUi((s) => s.intro);
  const system = useSystem();
  const stages = stagesFor(system);

  useEffect(() => {
    uiStore.set({ focus: { kind: "none" } });
    let raf = 0;
    const read = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        uiStore.set({ progressTarget: read() });
      });
    };
    // A reload deep in the page lands there at once; only later moves glide.
    const at = read();
    uiStore.set({ progress: at, progressTarget: at });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const introDone = intro >= 0.97;
  const planetStops = stages.filter((s) => s.kind === "planet").length;
  const ghostStops = stages.filter((s) => s.kind === "ghost").length;
  let planetSeen = 0;
  let ghostSeen = 0;

  return (
    <>
      {/* the scroll itself: one viewport per stage */}
      <div aria-hidden style={{ height: `${stages.length * 100}vh` }} />

      <div className="stage-layer">
        {stages.map((stage, i) => {
          const presence = introDone ? stagePresence(progress, i, stages.length) : i === 0 ? intro : 0;
          const on = presence > 0.5;
          let stop = "";
          if (stage.kind === "planet") stop = `${++planetSeen} / ${planetStops}`;
          if (stage.kind === "ghost") stop = `${++ghostSeen} / ${ghostStops}`;
          return (
            <section key={stage.key} className="stage" data-on={on ? "1" : "0"} style={{ opacity: presence }} aria-hidden={!on}>
              {stage.kind === "wide" && <Title />}
              {(stage.kind === "planet" || stage.kind === "ghost") && <PlanetSheet bodyKey={stage.bodyKey!} mode="journey" stop={stop} />}
              {stage.kind === "sun" && <SunSheet mode="journey" />}
              {stage.kind === "how" && <How />}
              {stage.kind === "end" && <End />}
            </section>
          );
        })}
      </div>

      <div className="scroll-hint" style={{ opacity: introDone && progress < 0.04 ? 1 : 0 }} aria-hidden>
        <span className="eyebrow">scroll to travel</span>
        <span className="line" />
      </div>
    </>
  );
}

function Title() {
  const system = useSystem();
  const first = system.planets[0];
  return (
    <div className="title-block">
      <span className="eyebrow">robinhood chain · {system.planets.length || "no"} planets lit · one treasury</span>
      <h1 className="display display-xl">{site.hook}</h1>
      <div className="title-sub">
        <p className="prose" style={{ margin: 0, maxWidth: "46ch" }}>
          The Sun is the treasury. Every planet is an asset, and anyone may light one. You do not hold a token — you <strong>choose your asset</strong>, and the Sun pays you in it.
        </p>
        {first ? (
          <Link href={`/${first.slug}`} className="btn">
            enter {first.catalog?.name ?? first.symbol} →
          </Link>
        ) : (
          <Link href="/deploy" className="btn">
            light the first planet →
          </Link>
        )}
      </div>
    </div>
  );
}

function How() {
  return (
    <div className="how-block">
      <div className="how-step">
        <span className="num">01 · fuel</span>
        <h3>Buy $ORBIT</h3>
        <p className="prose" style={{ margin: 0 }}>
          On its Pons V2 curve. Every trade pays creator fees to the Sun, in ETH — the only thing that ever feeds it. Lighting a planet feeds it too.
        </p>
      </div>
      <div className="how-step">
        <span className="num">02 · gravity</span>
        <h3>Choose a planet</h3>
        <p className="prose" style={{ margin: 0 }}>
          Any asset anyone has lit. Launch a <strong>satellite</strong> — leave after a day — or claim one of the planet&apos;s twelve <strong>orbits</strong>: locked one revolution, twice the gravity. Your gravity is the planet&apos;s mass.
        </p>
      </div>
      <div className="how-step">
        <span className="num">03 · wind</span>
        <h3>Harvest the asset</h3>
        <p className="prose" style={{ margin: 0 }}>
          The Sun splits its ETH between planets by mass; the solar wind turns each planet&apos;s share into its own asset. Same yield per unit of gravity everywhere — you are choosing what you are paid in, not chasing a rate.
        </p>
        <Link href="/docs" className="btn btn-sm" style={{ alignSelf: "flex-start", marginTop: 6 }}>
          read the docs →
        </Link>
      </div>
    </div>
  );
}

function End() {
  const system = useSystem();
  return (
    <div className="end-block">
      <h2 className="display display-lg" style={{ margin: 0 }}>
        Choose your asset.
      </h2>
      <div className="planet-row">
        {system.planets.map((p) => (
          <Link key={p.key} href={`/${p.slug}`}>
            {p.symbol}
          </Link>
        ))}
        {system.ghosts.map((g) => (
          <Link key={g.key} href={`/${g.candidate.slug}`} data-dark="1">
            {g.candidate.symbol} · {g.deployable ? "unlit" : "no token"}
          </Link>
        ))}
        <Link href="/sun" style={{ color: "var(--gold)" }}>
          SUN
        </Link>
        <Link href="/deploy" style={{ color: "var(--ink)" }}>
          + light a planet
        </Link>
      </div>
      <div className="footer-lines">
        <span>
          sun{" "}
          <a href={explorer.address(SUN)} target="_blank" rel="noreferrer">
            {shortAddress(SUN, 6)}
          </a>{" "}
          · {system.deployed ? "on chain" : "deterministic, not deployed until someone does"}
        </span>
        <Link href="/docs">docs</Link>
        <Link href="/deploy">deploy</Link>
        <span>not affiliated with robinhood, nvidia, apple, tesla, meta or state street · tokenized stocks are claims on their issuer, not shares · nothing here is financial advice</span>
      </div>
    </div>
  );
}
