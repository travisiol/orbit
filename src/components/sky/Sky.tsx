"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { BRIEF, ZERO_ADDRESS } from "@/lib/planets";
import { systemStore, useSystem } from "@/lib/systemStore";
import { uiStore, useUi } from "@/lib/ui";
import type { Projected, Universe } from "@/lib/three/universe";
import { GhostLabel, PlanetLabel, SunLabel } from "./Labels";

/**
 * The fixed canvas behind everything, and the HUD labels that ride on it.
 *
 * The three.js scene is created once, on the client, and lives for the
 * whole visit — the layout mounts this component, pages only change the
 * focus. Labels are DOM nodes positioned by the frame loop through refs, so
 * nothing re-renders at 60 fps; their text re-renders when the system
 * store changes.
 */
export function Sky() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const sunRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const webgl = useUi((s) => s.webgl);
  const system = useSystem();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let universe: Universe | null = null;
    let raf = 0;
    let last = performance.now();
    let cancelled = false;
    let errorShown = false;
    const projected: Projected[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 720px)").matches;
    const quality: "high" | "low" = small || (navigator as { hardwareConcurrency?: number }).hardwareConcurrency! <= 4 ? "low" : "high";
    uiStore.set({ reducedMotion: reduced });

    const size = () => {
      if (!universe) return;
      universe.resize(canvas.clientWidth, canvas.clientHeight);
    };

    const place = () => {
      if (!universe) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      universe.project(w, h, projected);
      const ui = uiStore.get();
      // Labels under an open sheet would show through its glass: hide them there.
      const sheet = document.querySelector<HTMLElement>('.stage[data-on="1"] .sheet-right, .frame .sheet-right');
      const rect = sheet ? sheet.getBoundingClientRect() : null;
      for (const p of projected) {
        const el = p.key === "sun" ? sunRef.current : labelRefs.current.get(p.key);
        if (!el) continue;
        const underSheet = rect ? p.x > rect.left - 40 && p.x < rect.right && p.y > rect.top - 20 && p.y < rect.bottom : false;
        const huge = p.radiusPx > w * 0.28; // filling the frame: the sheet already names it
        const onScreen = p.visible && !underSheet && !huge && p.x > -200 && p.x < w + 200 && p.y > -100 && p.y < h + 100;
        const focused = ui.focus.kind === "planet" && ui.focus.key === p.key;
        const hideForFocus = ui.focus.kind !== "none" && !focused && !(ui.focus.kind === "sun" && p.key === "sun");
        // In orbit around a body, only that body keeps its label; near the Sun, none — the sheet says it all.
        const show = onScreen && ui.intro >= 0.97 && !hideForFocus && ui.focus.kind !== "sun" && !(p.key === "sun" && p.depth < 15);
        el.style.opacity = show ? "1" : "0";
        el.style.pointerEvents = show ? "auto" : "none";
        // Sit the label just off the body's right shoulder.
        const dx = p.radiusPx + 14;
        const dy = -p.radiusPx * 0.55 - 8;
        el.style.transform = `translate3d(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px, 0)`;
        el.style.setProperty("--leader", `${Math.max(8, Math.round(p.radiusPx * 0.5))}px`);
        el.dataset.depth = p.depth < 6 ? "near" : p.depth < 14 ? "mid" : "far";
      }
    };

    const loop = (t: number) => {
      if (cancelled) return;
      const dt = (t - last) / 1000;
      last = t;
      // Browsers already stop requestAnimationFrame in hidden tabs; no extra guard, so an
      // embedded pane that keeps ticking while "hidden" still gets its frames. A frame that
      // throws is logged and skipped — the sky must never freeze on one bad frame.
      if (universe) {
        try {
          universe.update(dt, t);
          place();
        } catch (e) {
          if (!errorShown) {
            errorShown = true;
            console.error("[orbit] frame failed", e);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };

    import("@/lib/three/universe")
      .then(({ Universe }) => {
        if (cancelled) return;
        try {
          universe = new Universe(canvas, { reducedMotion: reduced, quality });
        } catch (e) {
          console.warn("[orbit] WebGL unavailable", e);
          uiStore.set({ webgl: "none", intro: 1 });
          return;
        }
        uiStore.set({ webgl: "ok" });
        // ?still skips the intro — for screenshots and for anyone who has seen it.
        if (window.location.search.includes("still")) universe.skipIntro();
        if (process.env.NODE_ENV !== "production") (window as unknown as { __orbit?: Universe }).__orbit = universe;
        size();
        last = performance.now();
        raf = requestAnimationFrame(loop);
      })
      .catch((e) => {
        console.warn("[orbit] sky failed to load", e);
        uiStore.set({ webgl: "none", intro: 1 });
      });

    const onResize = () => size();
    const onMove = (e: PointerEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = -(e.clientY / window.innerHeight) * 2 + 1;
      uiStore.set({ pointerX: x, pointerY: y });
      universe?.setPointer(x, y, true);
    };
    const onLeave = () => universe?.setPointer(-10, -10, false);
    const onVisibility = () => {
      last = performance.now();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      universe?.dispose();
    };
  }, []);

  const onCanvasClick = () => {
    const { hover, focus, intro } = uiStore.get();
    if (intro < 0.97) return;
    if (hover !== null && !(focus.kind === "planet" && focus.key === hover)) {
      const sys = systemStore.get().system;
      const planet = sys.planets.find((p) => p.key === hover);
      const ghost = sys.ghosts.find((g) => g.key === hover);
      const slug = planet?.slug ?? ghost?.candidate.slug;
      if (slug) router.push(`/${slug}`);
    }
  };

  const setRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) labelRefs.current.set(key, el);
    else labelRefs.current.delete(key);
  };

  return (
    <div className="sky" aria-hidden={webgl === "none" ? undefined : true}>
      <canvas ref={canvasRef} className="sky-canvas" onClick={onCanvasClick} />
      {webgl === "none" && <StillSky />}
      <div className="hud-layer">
        {system.planets.map((p) => (
          <PlanetLabel key={p.key} planet={p} ref={setRef(p.key)} />
        ))}
        {system.ghosts.map((g) => (
          <GhostLabel key={g.key} ghost={g} ref={setRef(g.key)} />
        ))}
        <SunLabel ref={sunRef} />
      </div>
    </div>
  );
}

/** Without WebGL: a still, drawn sky so the site is never a blank screen. */
function StillSky() {
  const angles = [0.4, 2.1, 3.9, 0.9, 5.2, 2.9];
  return (
    <svg className="sky-still" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="img" aria-label="The ORBIT system: a sun and its planets on their orbits">
      <defs>
        <radialGradient id="sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff6e2" />
          <stop offset="0.25" stopColor="#ffe9c2" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffe9c2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="#000" />
      {BRIEF.map((c, i) => {
        const r = 3.4 + 1.55 * i;
        return <ellipse key={c.slug} cx="800" cy="470" rx={r * 52} ry={r * 21} fill="none" stroke="#fff" strokeOpacity={c.asset === ZERO_ADDRESS ? 0.08 : 0.16} />;
      })}
      <circle cx="800" cy="470" r="120" fill="url(#sun)" />
      <circle cx="800" cy="470" r="26" fill="#fff6e2" />
      {BRIEF.map((c, i) => {
        const r = 3.4 + 1.55 * i;
        const a = angles[i];
        const dark = c.asset === ZERO_ADDRESS;
        return <circle key={c.slug} cx={800 + Math.cos(a) * r * 52} cy={470 + Math.sin(a) * r * 21} r={dark ? 7 : 12} fill={dark ? "#1a1c20" : c.surface === "gold" ? "#caa24a" : "#d7dbe2"} />;
      })}
    </svg>
  );
}
