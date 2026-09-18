import { createStore, useStore } from "./store";
import type { SystemState } from "./system";

/** Where the camera is: the intro, the scroll journey, or in orbit around one body. */
export type Focus = { kind: "none" } | { kind: "planet"; key: string } | { kind: "sun" };

export type UiState = {
  /** 0 → 1 while the point of light becomes the system; 1 afterwards. */
  intro: number;
  /** Scroll progress through the home journey, 0 → 1 — eased by the frame loop. */
  progress: number;
  /** Where the scrollbar actually is, 0 → 1; the raw input `progress` glides toward. */
  progressTarget: number;
  /** Key of the body under the pointer (planet:… or ghost:…). */
  hover: string | null;
  focus: Focus;
  reducedMotion: boolean;
  /** Set by the scene once WebGL is up; the HUD shows a still fallback otherwise. */
  webgl: "unknown" | "ok" | "none";
  /** Pointer in normalized device coordinates, for the parallax. */
  pointerX: number;
  pointerY: number;
};

export const uiStore = createStore<UiState>({
  intro: 0,
  progress: 0,
  progressTarget: 0,
  hover: null,
  focus: { kind: "none" },
  reducedMotion: false,
  webgl: "unknown",
  pointerX: 0,
  pointerY: 0,
});

export function useUi<S>(select: (s: UiState) => S): S {
  return useStore(uiStore, select);
}

/**
 * The home journey, in scroll order: the wide sky, every lit planet from
 * the innermost out, the candidates nobody has lit, then the Sun, the
 * mechanism, and the end. Each stage is one viewport of scroll. The list
 * follows the sky: light a planet and the journey gains a stop.
 */
export type Stage = { key: string; kind: "wide" | "planet" | "ghost" | "sun" | "how" | "end"; bodyKey?: string };

export function stagesFor(system: SystemState): Stage[] {
  return [
    { key: "wide", kind: "wide" },
    ...system.planets.map((p) => ({ key: p.key, kind: "planet" as const, bodyKey: p.key })),
    ...system.ghosts.map((g) => ({ key: g.key, kind: "ghost" as const, bodyKey: g.key })),
    { key: "sun", kind: "sun" },
    { key: "how", kind: "how" },
    { key: "end", kind: "end" },
  ];
}

/** Stage position as a float (2.4 = 40% of the way from stage 2 to stage 3). */
export function stageAt(progress: number, count: number): number {
  return Math.min(count - 1, Math.max(0, progress * (count - 1)));
}

/** How present stage `i` is at `progress`, 0–1, with a plateau around the stage itself. */
export function stagePresence(progress: number, i: number, count: number): number {
  const d = Math.abs(stageAt(progress, count) - i);
  if (d < 0.32) return 1;
  if (d > 0.62) return 0;
  return 1 - (d - 0.32) / 0.3;
}
