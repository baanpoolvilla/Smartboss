import { useState } from "react";

/**
 * Caps a list to `initialCount` items until expanded — the "Show more"
 * pattern (MS Teams' Planner "Completed tasks N ⌄") instead of a fixed-height
 * scrollbox that clips the list mid-row and hides how much more there is.
 */
export function useShowMore<T>(items: T[], initialCount: number) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialCount);
  const remaining = items.length - visible.length;
  return { visible, remaining, expanded, toggle: () => setExpanded((v) => !v) };
}
