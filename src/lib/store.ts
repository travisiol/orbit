import { useSyncExternalStore } from "react";

/**
 * A minimal external store: the three.js scene reads it every frame without
 * React in the loop, React components subscribe to slices of it with
 * useSyncExternalStore. No effects setting state, no hydration drift — the
 * server snapshot is the initial state.
 */
export type Store<T> = {
  get: () => T;
  set: (patch: Partial<T> | ((prev: T) => Partial<T>)) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      const next = typeof patch === "function" ? patch(state) : patch;
      let changed = false;
      for (const key in next) {
        if (!Object.is((state as Record<string, unknown>)[key], (next as Record<string, unknown>)[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...next };
      listeners.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}
