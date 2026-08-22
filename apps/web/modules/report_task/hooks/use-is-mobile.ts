import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Tracks the `< 640px` mobile breakpoint in JS — for the handful of spots
 * where mobile vs. desktop isn't just different CSS classes on the same
 * markup (Tailwind `sm:` handles that everywhere else) but an actually
 * different structure to render (e.g. a compact list instead of a
 * `<table>`, or how many cards a column shows before "แสดงเพิ่มเติม").
 * Starts `false` (matches desktop-first SSR output) and corrects on mount —
 * a one-frame flash on a phone is preferable to hydration mismatch warnings.
 *
 * `useSyncExternalStore`, not `useEffect` + `setState`: a media query *is* an
 * external store, and subscribing to one from an effect that immediately sets
 * state is what `react-hooks/set-state-in-effect` flags (it can cascade an
 * extra render pass). The server snapshot returning `false` is what keeps the
 * desktop-first SSR behaviour described above.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
