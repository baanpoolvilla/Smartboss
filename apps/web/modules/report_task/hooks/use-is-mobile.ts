import { useEffect, useState } from "react";

/**
 * Tracks the `< 640px` mobile breakpoint in JS — for the handful of spots
 * where mobile vs. desktop isn't just different CSS classes on the same
 * markup (Tailwind `sm:` handles that everywhere else) but an actually
 * different structure to render (e.g. a compact list instead of a
 * `<table>`, or how many cards a column shows before "แสดงเพิ่มเติม").
 * Starts `false` (matches desktop-first SSR output) and corrects on mount —
 * a one-frame flash on a phone is preferable to hydration mismatch warnings.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
