"use client";

import { useEffect } from "react";
import { uiStore, type Focus } from "@/lib/ui";

/** A page's only say over the sky: where the camera goes. */
export function FocusSetter({ focus }: { focus: Focus }) {
  useEffect(() => {
    uiStore.set({ focus });
  }, [focus]);
  return null;
}
