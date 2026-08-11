"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(hover: hover)";

function subscribe(callback: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

// Desktop's existing hover-then-click behavior — assumed until hydration can
// read the real media query, so server-rendered markup never assumes touch.
function getServerSnapshot() {
  return true;
}

/**
 * True on devices with a real pointer that supports `:hover` (mouse,
 * trackpad) — false on touch-only devices, where nothing can hover so a tap
 * has to double as the "peek at this" gesture instead. `useSyncExternalStore`
 * (not an effect + setState) because this is exactly what it's for:
 * subscribing to a value that lives outside React.
 */
export function useHasHover(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
