import { displayName } from "@/modules/report_task/lib/directory";

const MAX_SHOWN = 6;

export interface RankedPerson {
  name: string;
  count: number;
}

/**
 * `counts` (personId -> count) sorted biggest-first, capped at MAX_SHOWN
 * with the remainder folded into one "อื่นๆ" row — same
 * fold-beyond-a-cap pattern the KPI chart's own person segments use
 * (see topPeople in system-kpi-summary.tsx), reused here for the two
 * Overview donuts' drill-down ranked list so a busy bucket doesn't turn
 * into an endless list.
 */
export function rankedPeople(counts: Map<string, number>): RankedPerson[] {
  const entries = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ name: displayName(id), count: n }))
    .sort((a, b) => b.count - a.count);
  if (entries.length <= MAX_SHOWN + 1) return entries;
  const rest = entries.slice(MAX_SHOWN);
  return [...entries.slice(0, MAX_SHOWN), { name: "อื่นๆ", count: rest.reduce((s, e) => s + e.count, 0) }];
}
