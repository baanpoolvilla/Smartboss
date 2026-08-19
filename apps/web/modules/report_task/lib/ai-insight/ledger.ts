import "server-only";

import { metricValueOf, type AiInsightAggregate } from "./aggregate";
import type { AiInsightAction, AiInsightDeptNote, AiInsightLedgerRecord, AiInsightPersonNote, InsightMetricKey, RecoStatus } from "./types";

/** Company subjectKey is a fixed sentinel — there's only ever one company. */
export const COMPANY_SUBJECT_KEY = "__company__";

const MAX_RESOLVED_KEEP = 20;
const MAX_TRAIL = 12;

function idOf(subjectType: AiInsightAction["subjectType"], subjectKey: string, metricKey: InsightMetricKey): string {
  return `${subjectType}|${subjectKey}|${metricKey}`;
}

/** Turns the model's free-text `{subjectType, subjectName, metricKey, ...}`
 * picks into resolvable, measurable actions — matches `subjectName` back to
 * a real departmentId/person-name in the aggregate and fills in
 * `subjectKey`, silently DROPPING anything that doesn't resolve (an
 * invented name, or person+success_rate which isn't a supported
 * combination) rather than throwing — a bad AI pick shouldn't break the
 * whole analysis round. */
export function resolveActions(agg: AiInsightAggregate, actions: Partial<AiInsightAction>[]): AiInsightAction[] {
  const out: AiInsightAction[] = [];
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const { subjectType, metricKey, detail, severity } = a;
    if (!subjectType || !metricKey || !detail || !severity) continue;
    if (subjectType === "person" && metricKey === "success_rate") continue; // person has no rate, only counts

    let subjectKey: string;
    let subjectName: string;
    if (subjectType === "company") {
      subjectKey = COMPANY_SUBJECT_KEY;
      subjectName = "บริษัท";
    } else if (subjectType === "department") {
      const dept = agg.departmentsAll.find((d) => d.name === a.subjectName);
      if (!dept) continue; // model invented a department name — drop it
      subjectKey = dept.departmentId;
      subjectName = dept.name;
    } else if (subjectType === "person") {
      if (!a.subjectName || !agg.personMetricsAll.has(a.subjectName)) continue; // model invented a person name — drop it
      subjectKey = a.subjectName;
      subjectName = a.subjectName;
    } else {
      continue;
    }

    if (metricValueOf(agg, subjectType, subjectKey, metricKey) == null) continue;
    const approach = Array.isArray(a.approach) ? a.approach.filter((s): s is string => typeof s === "string") : undefined;
    out.push({ subjectType, subjectKey, subjectName, metricKey, detail, severity, ...(approach?.length ? { approach } : {}) });
  }
  return out;
}

/** §6.2 of docs/ai-insight-v2-spec.md — "ทั้ง actions และ personNotes/deptNotes
 * เจาะ target ที่วัดได้เป๊ะ" — personNotes/deptNotes carry a `metricKey` too
 * (see types.ts), so they feed the ledger the same way `actions` do, just
 * without a model-given severity (there's no signal for it at that
 * granularity, so every note-derived entry defaults to "mid"). Same
 * silent-drop-on-mismatch behavior as `resolveActions`. */
export function resolveNoteActions(
  agg: AiInsightAggregate,
  personNotes: AiInsightPersonNote[],
  deptNotes: AiInsightDeptNote[]
): AiInsightAction[] {
  const out: AiInsightAction[] = [];
  for (const n of personNotes) {
    if (!n?.name || !n.metricKey || n.metricKey === "success_rate") continue; // person has no rate, only counts
    if (!agg.personMetricsAll.has(n.name)) continue; // model invented a person name — drop it
    if (metricValueOf(agg, "person", n.name, n.metricKey) == null) continue;
    out.push({ subjectType: "person", subjectKey: n.name, subjectName: n.name, metricKey: n.metricKey, detail: n.priority, severity: "mid" });
  }
  for (const n of deptNotes) {
    if (!n?.name || !n.metricKey) continue;
    const dept = agg.departmentsAll.find((d) => d.name === n.name);
    if (!dept) continue; // model invented a department name — drop it
    if (metricValueOf(agg, "department", dept.departmentId, n.metricKey) == null) continue;
    out.push({ subjectType: "department", subjectKey: dept.departmentId, subjectName: dept.name, metricKey: n.metricKey, detail: n.note, severity: "mid" });
  }
  return out;
}

/** "Lower is better" for every metric except success_rate — reaching 0
 * means fully resolved, below baseline but not zero means improving, above
 * baseline means regressed, unchanged holds "open". success_rate runs the
 * opposite direction (higher is better) and has no natural "zero means
 * done" state, so it only ever improves/regresses/holds, never resolves.
 * Always computed from the fixed `baseline`, never the previous status, so
 * a record that regresses after improving correctly flips back. */
function statusOf(metricKey: InsightMetricKey, baseline: number, latest: number): RecoStatus {
  if (metricKey === "success_rate") {
    if (latest > baseline) return "improved";
    if (latest < baseline) return "regressed";
    return "open";
  }
  if (latest === 0) return "resolved";
  if (latest < baseline) return "improved";
  if (latest > baseline) return "regressed";
  return "open";
}

/** Baseline→latest tracking for every recommendation ever given, called
 * once per analysis round with this round's *resolved* actions (see
 * `resolveActions`):
 * - a resolved action not already in the ledger → new "open" record,
 *   baseline = current metric value
 * - a resolved action matching an existing non-resolved record → re-measured,
 *   status recomputed, detail/severity refreshed to this round's text
 * - an existing non-resolved record NOT mentioned again this round → still
 *   re-measured (the ledger keeps tracking it even after the model stops
 *   picking it), detail/severity left as last written
 * - an existing "resolved" record → left untouched, just capped to the
 *   most recent MAX_RESOLVED_KEEP so the list doesn't grow forever
 */
export function reconcile(
  ledger: AiInsightLedgerRecord[],
  agg: AiInsightAggregate,
  actions: AiInsightAction[],
  now: string
): AiInsightLedgerRecord[] {
  const byId = new Map(ledger.map((r) => [r.id, r] as const));
  const seenIds = new Set<string>();

  for (const a of actions) {
    const id = idOf(a.subjectType, a.subjectKey, a.metricKey);
    seenIds.add(id);
    const value = metricValueOf(agg, a.subjectType, a.subjectKey, a.metricKey);
    if (value == null) continue;

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        subjectType: a.subjectType,
        subjectKey: a.subjectKey,
        subjectName: a.subjectName,
        metricKey: a.metricKey,
        detail: a.detail,
        severity: a.severity,
        issuedAt: now,
        baseline: value,
        latestValue: value,
        checkedAt: now,
        status: "open",
        trail: [{ at: now, value }],
      });
      continue;
    }
    if (existing.status === "resolved") continue; // already fixed — a repeat mention doesn't reopen it

    byId.set(id, {
      ...existing,
      subjectName: a.subjectName,
      detail: a.detail,
      severity: a.severity,
      latestValue: value,
      checkedAt: now,
      status: statusOf(a.metricKey, existing.baseline, value),
      trail: [...existing.trail, { at: now, value }].slice(-MAX_TRAIL),
    });
  }

  for (const [id, r] of byId) {
    if (seenIds.has(id) || r.status === "resolved") continue;
    const value = metricValueOf(agg, r.subjectType, r.subjectKey, r.metricKey);
    if (value == null) continue;
    byId.set(id, {
      ...r,
      latestValue: value,
      checkedAt: now,
      status: statusOf(r.metricKey, r.baseline, value),
      trail: [...r.trail, { at: now, value }].slice(-MAX_TRAIL),
    });
  }

  const all = [...byId.values()];
  const active = all.filter((r) => r.status !== "resolved");
  const resolved = all
    .filter((r) => r.status === "resolved")
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())
    .slice(0, MAX_RESOLVED_KEEP);
  return [...active, ...resolved];
}
