import { createStore, useStore } from "./store";
import { previewSystem } from "./preview";
import { SUN } from "./sunDeploy";
import type { SystemState } from "./system";

/**
 * The one store the sky and the HUD both read. It starts as the preview
 * simulation at a fixed instant — identical on server and client — and is
 * replaced by chain reads when a Sun answers (components/SystemFeed.tsx).
 */
export const systemStore = createStore<{ system: SystemState }>({ system: previewSystem(SUN) });

export function useSystem(): SystemState {
  return useStore(systemStore, (s) => s.system);
}
