import "server-only";
import type { AiInsightAggregate } from "./aggregate";

/** One round's numbers, stripped down to just what's needed to compute a
 * trend later — no AI text, so 24 of these stay lightweight (see
 * MAX_SNAPSHOTS). Server-only, never exposed to the generic client-writable
 * store route (see analyze.ts's HISTORY_KEY comment) — a client forging its
 * own history could fake a "improving" trend that never happened. */
export interface AiInsightSnapshot {
  at: string; // ISO
  combinedSuccessRate: number;
  deptRates: Record<string, number>; // departmentId -> successRate
  personTotals: Record<string, number>; // name -> openTotal
  flaggedCounts: Record<string, number>; // "domain:key" -> count
}

export interface AiInsightHistory {
  snapshots: AiInsightSnapshot[]; // old → new
}

export const EMPTY_HISTORY: AiInsightHistory = { snapshots: [] };

/** ~2 months of daily-ish history at Pro's 50/month quota — plenty to see a
 * direction without the store row growing without bound. */
const MAX_SNAPSHOTS = 24;

export function snapshotFromAggregate(agg: AiInsightAggregate): AiInsightSnapshot {
  const deptRates: Record<string, number> = {};
  for (const d of agg.departments) deptRates[d.departmentId] = d.successRate;

  const personTotals: Record<string, number> = {};
  for (const p of agg.people) personTotals[p.name] = p.total;

  const flaggedCounts: Record<string, number> = {};
  for (const g of agg.flagged) flaggedCounts[`${g.domain}:${g.key}`] = g.count;

  return { at: new Date().toISOString(), combinedSuccessRate: agg.combinedSuccessRate, deptRates, personTotals, flaggedCounts };
}

export function appendSnapshot(history: AiInsightHistory, snapshot: AiInsightSnapshot): AiInsightHistory {
  return { snapshots: [...history.snapshots, snapshot].slice(-MAX_SNAPSHOTS) };
}

export interface Trend {
  dir: "up" | "down" | "flat";
  /** "rate" subjects: signed percentage-*point* delta (52→45 = -7).
   * "count" subjects: signed relative percent change (28→12 = -57). Which
   * one a given Trend holds depends entirely on which `kind` computeTrend
   * was called with — callers already know that from the subject type, so
   * this isn't tagged on the value itself. */
  change: number;
}

/** ≤2 (points for a rate, % for a count) reads as noise, not a real move —
 * same idea as the dashboard's own trend badges elsewhere, just applied to
 * history instead of a single previous-period comparison. */
const FLAT_THRESHOLD = 2;

function valueAt(snapshot: AiInsightSnapshot, subjectKey: string): number | null {
  if (subjectKey === "company") return snapshot.combinedSuccessRate;
  if (subjectKey.startsWith("dept:")) return snapshot.deptRates[subjectKey.slice(5)] ?? null;
  if (subjectKey.startsWith("person:")) return snapshot.personTotals[subjectKey.slice(7)] ?? null;
  return null;
}

/**
 * Compares the oldest vs. newest value within the last `windowSize`
 * snapshots that actually have this subject (a person/department can be
 * absent from older rounds — newly flagged, or resolved-and-reappeared —
 * so this filters to present values rather than assuming every snapshot
 * has every subject). Returns null with fewer than 2 data points — nothing
 * to compare yet, not "flat".
 */
export function computeTrend(history: AiInsightHistory, subjectKey: string, kind: "rate" | "count", windowSize = 3): Trend | null {
  const values = history.snapshots.map((s) => valueAt(s, subjectKey)).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const window = values.slice(-windowSize);
  const oldest = window[0]!;
  const latest = window[window.length - 1]!;

  const change =
    kind === "rate" ? latest - oldest : oldest !== 0 ? Math.round(((latest - oldest) / oldest) * 100) : latest !== 0 ? 100 : 0;
  const dir: Trend["dir"] = Math.abs(change) <= FLAT_THRESHOLD ? "flat" : change > 0 ? "up" : "down";
  return { dir, change };
}
