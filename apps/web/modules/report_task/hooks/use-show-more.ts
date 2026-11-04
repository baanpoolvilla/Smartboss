import { useState } from "react";

/**
 * Caps a list to `initialCount` items until expanded — the "Show more"
 * pattern (MS Teams' Planner "Completed tasks N ⌄") instead of a fixed-height
 * scrollbox that clips the list mid-row and hides how much more there is.
 */
export function useShowMore<T>(items: T[], initialCount: number, step?: number) {
  const [expanded, setExpanded] = useState(false);
  const [clicks, setClicks] = useState(0);
  // ส่ง step มา = กดเพิ่มทีละ step แทนการเปิดทั้งหมดทีเดียว (ไม่ส่ง = แบบเดิม)
  if (step) {
    const visible = items.slice(0, initialCount + clicks * step);
    return {
      visible,
      remaining: items.length - visible.length,
      expanded: clicks > 0,
      toggle: () => setClicks((n) => n + 1),
      reset: () => setClicks(0),
    };
  }
  const visible = expanded ? items : items.slice(0, initialCount);
  const remaining = items.length - visible.length;
  return { visible, remaining, expanded, toggle: () => setExpanded((v) => !v), reset: undefined };
}
