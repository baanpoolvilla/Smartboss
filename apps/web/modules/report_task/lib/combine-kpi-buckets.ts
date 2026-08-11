import type { KpiBuckets } from "@/modules/report_task/lib/kpi-buckets";

/**
 * Merges two `KpiBuckets` (Task + Report) into one combined set for views
 * that show a single "everything" summary instead of the two side by side.
 * Every rate is recomputed from the summed counts — not an average of the
 * two rates — so it doesn't skew toward whichever side has fewer items.
 * Deliberately kept separate from kpi-buckets.ts (mirrors its `finalize`
 * formula rather than importing it) so the KPI calculation source stays
 * untouched.
 */
export function combineKpiBuckets(a: KpiBuckets, b: KpiBuckets): KpiBuckets {
  const onTime = a.onTime + b.onTime;
  const lateDone = a.lateDone + b.lateDone;
  const pending = a.pending + b.pending;
  const overdue = a.overdue + b.overdue;
  const exempt = a.exempt + b.exempt;
  const total = onTime + lateDone + pending + overdue;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return {
    onTime,
    lateDone,
    pending,
    overdue,
    exempt,
    total,
    successRate: pct(onTime + lateDone),
    onTimeRate: pct(onTime),
    lateRate: pct(lateDone),
    overdueRate: pct(overdue),
  };
}
