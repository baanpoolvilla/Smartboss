import "server-only";

import { metricValueOf, type AiInsightAggregate } from "./aggregate";
import type { AiInsightAction, AiInsightLedgerRecord, InsightMetricKey, RecoStatus } from "./types";

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
    out.push({ subjectType, subjectKey, subjectName, metricKey, detail, severity });
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
