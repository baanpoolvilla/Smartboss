import "server-only";

import { readTasks } from "@/modules/report_task/lib/db/task-repo";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory, type DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
import { listDepartmentsWithOverlay } from "@/modules/report_task/lib/db/departments";
import { taskKpiBuckets, taskBucketsByAssignee, type KpiBuckets, type KpiBucketKey } from "@/modules/report_task/lib/kpi-buckets";
import {
  trackedTopicsOf,
  dayComplianceStatus,
  iterationBounds,
  eachDay,
  type ReportStatusCounts,
} from "@/modules/report_task/lib/report-feed-compliance";
import type { Task } from "@/modules/report_task/types";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { AiInsightStat, InsightMetricKey, RecoSubjectType } from "./types";

/** The 7 "count" metrics, all built the same way from a task/report bucket
 * pair — shared by company/department/person so the three levels can never
 * disagree on what e.g. "overdue_tasks" means. `success_rate` is handled
 * separately per-caller since person subjects don't support it (see
 * metricValueOf). */
function countMetricsOf(
  t: { overdue: number; pending: number; lateDone: number },
  r: { missed: number; pending: number; lateDone: number }
): Record<Exclude<InsightMetricKey, "success_rate">, number> {
  return {
    overdue_tasks: t.overdue,
    pending_tasks: t.pending,
    late_tasks: t.lateDone,
    missed_reports: r.missed,
    pending_reports: r.pending,
    late_reports: r.lateDone,
    open_total: t.overdue + t.pending + r.missed + r.pending,
  };
}

/**
 * Server-side twin of `reportStatusCountsByUser` — that function (and
 * `mustReportToTopic`/`canSeeReportTopic` under it) reads the module-level
 * `users`/`departments` arrays from lib/directory.ts, which only exist
 * client-side (populated by the zustand stores after hydration). A server
 * route has no such state, so this walks the exact same tracked-topic ×
 * day × user loop (via the now-exported `dayComplianceStatus`/
 * `iterationBounds`/`eachDay`) against a real `DirectoryUser[]` from the DB
 * instead. Simplification vs. the client version: no per-date-exemption
 * (leave/holiday) lookup and no "managerOnly" room nuance beyond `isOwner` —
 * acceptable here because this only feeds an LLM summary prompt, not the
 * live dashboard's own numbers (which still come from the original
 * client-side functions and are unaffected by this file).
 */
export function mustReportToTopicServer(visibility: ReportTopic["visibility"], user: DirectoryUser): boolean {
  if (user.isOwner) return false;
  if (visibility?.exemptUserIds?.includes(user.id)) return false;
  if (!visibility || (!visibility.managerOnly && !visibility.departmentIds?.length && !visibility.userIds?.length)) return true;
  if (visibility.userIds?.length) return visibility.userIds.includes(user.id);
  if (visibility.managerOnly) return false; // approximation — see comment above
  if (visibility.departmentIds?.length) {
    const inDept = !!user.departmentId && visibility.departmentIds.includes(user.departmentId);
    const inExtra = visibility.extraUserIds?.includes(user.id) ?? false;
    if (!inDept && !inExtra) return false;
  }
  return true;
}

function reportStatusCountsByUserServer(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  users: DirectoryUser[]
): Map<string, ReportStatusCounts> {
  const tracked = trackedTopicsOf(topics);
  const out = new Map<string, ReportStatusCounts>();
  for (const u of users) out.set(u.id, { onTime: 0, lateDone: 0, pending: 0, missed: 0, exempt: 0 });
  for (const topic of tracked) {
    const { startStr, endStr } = iterationBounds(topic, range);
    const days = eachDay(startStr, endStr);
    for (const u of users) {
      if (!mustReportToTopicServer(topic.visibility, u)) continue;
      const counts = out.get(u.id)!;
      for (const day of days) {
        const status = dayComplianceStatus(topic, u.id, day, posts);
        if (status === "on-time") counts.onTime += 1;
        else if (status === "late") counts.lateDone += 1;
        else if (status === "pending") counts.pending += 1;
        else if (status === "missed") counts.missed += 1;
        else counts.exempt += 1;
      }
    }
  }
  return out;
}

function finalizeReport(byUser: Map<string, ReportStatusCounts>): KpiBuckets {
  let onTime = 0, lateDone = 0, pending = 0, missed = 0;
  for (const c of byUser.values()) {
    onTime += c.onTime;
    lateDone += c.lateDone;
    pending += c.pending;
    missed += c.missed;
  }
  const total = onTime + lateDone + pending + missed;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return {
    onTime, lateDone, pending, overdue: missed, exempt: 0, total,
    successRate: pct(onTime + lateDone), onTimeRate: pct(onTime), lateRate: pct(lateDone), overdueRate: pct(missed),
  };
}

export interface FlaggedPerson {
  name: string;
  count: number;
}

export interface FlaggedGroup {
  key: KpiBucketKey | "missed";
  label: string;
  domain: "task" | "report";
  count: number;
  /** Top offenders in this bucket, biggest first, capped — this (not the
   * bucket total) is what keeps the prompt's size roughly flat regardless
   * of company size: a 500-person org still only ever sends its worst 8. */
  people: FlaggedPerson[];
}

const MAX_PEOPLE_PER_GROUP = 8;

function topPeopleOf(byId: Map<string, number>, nameOf: Map<string, string>): FlaggedPerson[] {
  return [...byId.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PEOPLE_PER_GROUP)
    .map(([id, count]) => ({ name: nameOf.get(id) ?? id, count }));
}

export interface PersonBreakdownItem {
  domain: "task" | "report";
  label: string;
  count: number;
}

export interface PersonBreakdown {
  name: string;
  total: number;
  items: PersonBreakdownItem[];
  /** Same numbers as `items`, keyed by metric instead of by display label —
   * what `metricValueOf` reads for this person. Deliberately built from the
   * exact same capped `items` (not a fresh uncapped query) so the ledger
   * always tracks the same number the card displays — a ledger baseline
   * that silently disagreed with what's on screen would be more confusing
   * than the rare edge case this trades away (someone who ranks in the
   * overall top 6 but, for one specific bucket, outside that bucket's own
   * top 8 — see MAX_PEOPLE_PER_GROUP). */
  metrics: Partial<Record<Exclude<InsightMetricKey, "success_rate">, number>>;
}

/** `FlaggedGroup.key`/`.domain` → the metric enum, computed once here
 * instead of via fragile display-label string matching. */
function metricKeyOf(domain: "task" | "report", key: KpiBucketKey | "missed"): Exclude<InsightMetricKey, "success_rate"> | null {
  if (domain === "task") {
    if (key === "overdue") return "overdue_tasks";
    if (key === "pending") return "pending_tasks";
    if (key === "lateDone") return "late_tasks";
    return null; // "missed" never occurs for task
  }
  if (key === "missed") return "missed_reports";
  if (key === "pending") return "pending_reports";
  if (key === "lateDone") return "late_reports";
  return null; // "overdue" never occurs for report (report's field is "missed")
}

const MAX_PEOPLE_OVERALL = 6;

/** Same `flagged` data, re-sliced *by person* instead of by bucket — one row
 * per flagged person with everything wrong for them combined (not spread
 * across separate bucket lists), so a prompt/UI can say "Katawut has 10
 * things open, here's the breakdown" instead of "Katawut appears in bucket A
 * with 7, and separately in bucket C with 3." Capped to the worst
 * `MAX_PEOPLE_OVERALL` overall — same flat-cost reasoning as `MAX_PEOPLE_PER_GROUP`. */
function personBreakdownOf(flagged: FlaggedGroup[]): PersonBreakdown[] {
  const byName = new Map<string, PersonBreakdown>();
  for (const g of flagged) {
    const metricKey = metricKeyOf(g.domain, g.key);
    for (const p of g.people) {
      let row = byName.get(p.name);
      if (!row) {
        row = { name: p.name, total: 0, items: [], metrics: {} };
        byName.set(p.name, row);
      }
      row.total += p.count;
      row.items.push({ domain: g.domain, label: g.label, count: p.count });
      if (metricKey) row.metrics[metricKey] = (row.metrics[metricKey] ?? 0) + p.count;
    }
  }
  for (const row of byName.values()) {
    row.metrics.open_total = (row.metrics.overdue_tasks ?? 0) + (row.metrics.pending_tasks ?? 0) + (row.metrics.missed_reports ?? 0) + (row.metrics.pending_reports ?? 0);
  }
  return [...byName.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_PEOPLE_OVERALL)
    .map((row) => ({ ...row, items: row.items.sort((a, b) => b.count - a.count) }));
}

export interface DeptTopIssue {
  domain: "task" | "report";
  label: string;
  count: number;
}

export interface DeptBreakdown {
  departmentId: string;
  name: string;
  headcount: number;
  successRate: number;
  openTotal: number;
  topIssues: DeptTopIssue[];
  /** What `metricValueOf` reads for this department — unlike person's
   * `metrics`, this is the exact uncapped sum (departments aren't capped
   * the way per-bucket people are), and includes `success_rate` (person's
   * doesn't — see PersonBreakdown.metrics). */
  metrics: Record<InsightMetricKey, number>;
}

const MAX_DEPTS = 6;
/** Synthetic bucket for anyone with no `departmentId` set — still worth
 * surfacing (their numbers don't just vanish) rather than silently
 * dropping them from every department-level number. */
const UNASSIGNED_DEPT_ID = "__unassigned__";

/** Same idea as `personBreakdownOf`, one level up — group by department
 * instead of by person. Reuses the exact same per-person bucket maps
 * (`byAssignee`, `reportByUser`) the person-level breakdown already built,
 * so a department's numbers are guaranteed to be the sum of its own
 * members' numbers — no separate query, no chance of drifting apart. */
function departmentBreakdownOf(
  directory: DirectoryUser[],
  deptNameOf: Map<string, string>,
  byAssignee: Record<KpiBucketKey, Map<string, number>>,
  reportByUser: Map<string, ReportStatusCounts>
): DeptBreakdown[] {
  // Owners aren't held to normal task/report obligations (see
  // mustReportToTopicServer) — folding them into a department's rate would
  // skew it against members who actually carry the workload.
  const membersByDept = new Map<string, DirectoryUser[]>();
  for (const u of directory) {
    if (u.isOwner) continue;
    const deptId = u.departmentId || UNASSIGNED_DEPT_ID;
    const list = membersByDept.get(deptId);
    if (list) list.push(u);
    else membersByDept.set(deptId, [u]);
  }

  const taskLabels: Record<"overdue" | "pending" | "lateDone", string> = {
    overdue: "งานเลยกำหนด",
    pending: "งานยังไม่เสร็จ (ในกำหนด)",
    lateDone: "งานเสร็จช้ากว่ากำหนด",
  };
  const reportLabels: Record<"missed" | "pending" | "lateDone", string> = {
    missed: "รายงานขาดส่ง",
    pending: "รายงานยังไม่ส่ง (ในกำหนด)",
    lateDone: "รายงานส่งช้ากว่ากำหนด",
  };

  const rows: DeptBreakdown[] = [];
  for (const [deptId, members] of membersByDept) {
    let tOnTime = 0, tLateDone = 0, tPending = 0, tOverdue = 0;
    let rOnTime = 0, rLateDone = 0, rPending = 0, rMissed = 0;
    for (const m of members) {
      tOnTime += byAssignee.onTime.get(m.id) ?? 0;
      tLateDone += byAssignee.lateDone.get(m.id) ?? 0;
      tPending += byAssignee.pending.get(m.id) ?? 0;
      tOverdue += byAssignee.overdue.get(m.id) ?? 0;
      const rc = reportByUser.get(m.id);
      if (rc) {
        rOnTime += rc.onTime;
        rLateDone += rc.lateDone;
        rPending += rc.pending;
        rMissed += rc.missed;
      }
    }
    const total = tOnTime + tLateDone + tPending + tOverdue + rOnTime + rLateDone + rPending + rMissed;
    const done = tOnTime + tLateDone + rOnTime + rLateDone;
    const successRate = total ? Math.round((done / total) * 100) : 0;
    const openTotal = tPending + tOverdue + rPending + rMissed;

    const topIssues: DeptTopIssue[] = [
      tOverdue > 0 ? { domain: "task" as const, label: taskLabels.overdue, count: tOverdue } : null,
      tPending > 0 ? { domain: "task" as const, label: taskLabels.pending, count: tPending } : null,
      tLateDone > 0 ? { domain: "task" as const, label: taskLabels.lateDone, count: tLateDone } : null,
      rMissed > 0 ? { domain: "report" as const, label: reportLabels.missed, count: rMissed } : null,
      rPending > 0 ? { domain: "report" as const, label: reportLabels.pending, count: rPending } : null,
      rLateDone > 0 ? { domain: "report" as const, label: reportLabels.lateDone, count: rLateDone } : null,
    ]
      .filter((x): x is DeptTopIssue => x !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    rows.push({
      departmentId: deptId,
      name: deptId === UNASSIGNED_DEPT_ID ? "ไม่ระบุแผนก" : (deptNameOf.get(deptId) ?? deptId),
      headcount: members.length,
      successRate,
      openTotal,
      topIssues,
      metrics: { ...countMetricsOf({ overdue: tOverdue, pending: tPending, lateDone: tLateDone }, { missed: rMissed, pending: rPending, lateDone: rLateDone }), success_rate: successRate },
    });
  }

  // Sorted worst-first, but NOT capped here — capping happens where this is
  // used for display/prompt (buildAiInsightAggregate's `departments`). The
  // full list stays available internally (`departmentsAll`) so a ledger
  // record for a department that has since improved out of the worst-N can
  // still be re-measured every round instead of going stale the moment it
  // drops off the "worst offenders" list.
  return rows.sort((a, b) => b.openTotal - a.openTotal);
}

/** Uncapped per-person metrics, straight from `byAssignee`/`reportByUser`
 * (every person, not just whoever made the capped `flagged` lists) — same
 * "ledger must be able to re-measure someone who's improved off the
 * worst-offenders list" reasoning as `departmentBreakdownOf` no longer
 * capping internally. Keyed by name, same accepted limitation as
 * PersonBreakdown (see its own comment on name-based keying). */
function personMetricsAllOf(
  directory: DirectoryUser[],
  byAssignee: Record<KpiBucketKey, Map<string, number>>,
  reportByUser: Map<string, ReportStatusCounts>
): Map<string, Record<Exclude<InsightMetricKey, "success_rate">, number>> {
  const out = new Map<string, Record<Exclude<InsightMetricKey, "success_rate">, number>>();
  for (const u of directory) {
    if (u.isOwner) continue;
    const t = { overdue: byAssignee.overdue.get(u.id) ?? 0, pending: byAssignee.pending.get(u.id) ?? 0, lateDone: byAssignee.lateDone.get(u.id) ?? 0 };
    const rc = reportByUser.get(u.id);
    const r = { missed: rc?.missed ?? 0, pending: rc?.pending ?? 0, lateDone: rc?.lateDone ?? 0 };
    out.set(u.name, countMetricsOf(t, r));
  }
  return out;
}

export interface AiInsightAggregate {
  task: KpiBuckets;
  report: KpiBuckets;
  totalTask: number;
  totalReport: number;
  /** Every non-empty overdue/pending/lateDone bucket, both domains — the
   * "what's actually wrong" list the AI prompt is built from. Ordered
   * biggest-impact first. */
  flagged: FlaggedGroup[];
  headcount: number;
  /** Combined task+report success rate right now. */
  combinedSuccessRate: number;
  /** What the combined rate would become if the single biggest flagged
   * group (flagged[0]) were fully resolved — computed here, not left to the
   * model to estimate, so the "ถ้าแก้ปัญหานี้ อัตราจะขึ้นเป็น Y%" line in the
   * prompt is an actual number instead of an LLM guess. This is the same
   * shape of claim the reference mockup's "ถ้าปิด Opportunity A, C, F ได้...
   * ถึง Target 102%" makes — a concrete payoff for fixing the top issue,
   * not a restatement of totals already visible elsewhere on the dashboard. */
  projectedSuccessRate: number | null;
  /** Every flagged person, re-sliced so each has ONE combined row (all their
   * open items across every bucket) instead of scattered per-bucket
   * mentions — what a per-person deep-dive is built from. */
  people: PersonBreakdown[];
  /** Worst-first, capped at MAX_DEPTS — same flat-cost reasoning as `people`. */
  departments: DeptBreakdown[];
  /** Every department, uncapped, worst-first — internal only (not sent to
   * the prompt), so `metricValueOf` can re-measure a department the ledger
   * is tracking even after it's improved out of the capped `departments`. */
  departmentsAll: DeptBreakdown[];
  /** What `metricValueOf` reads for subjectType "company". */
  companyMetrics: Record<InsightMetricKey, number>;
  /** Every person, uncapped — same "ledger must keep re-measuring" reasoning
   * as `departmentsAll`. */
  personMetricsAll: Map<string, Record<Exclude<InsightMetricKey, "success_rate">, number>>;
  /** Headcount with an overdue task or a missed report right now — "คนควรคุย
   * ด่วน" on the KPI tiles. Computed from the uncapped `personMetricsAll`
   * (not the capped `people`/`flagged` lists), so it's a real count, not
   * "however many named people fit in the top-N shown to the prompt". */
  urgentPeopleCount: number;
  /** Raw ingredients this aggregate was built from — exposed so the §16
   * analyzers (lib/ai-insight/analyzers/*.ts) can run their own bounded
   * queries (e.g. "who's missing THIS specific report topic") without a
   * second DB round-trip. `AiInsightAggregate` is never persisted/serialized
   * as-is (only the capped fields that go into `AiInsightState` are), so
   * carrying the full raw lists here costs nothing extra. */
  tasks: Task[];
  topics: ReportTopic[];
  posts: ReportPost[];
  directory: DirectoryUser[];
}

/**
 * Looks up one metric's current value for one subject — the single source
 * of truth both the recommendation ledger's reconciliation (`ledger.ts`)
 * and action-resolution (validating what the model picked) read from, so
 * "what a baseline meant" and "what we're comparing it to next round" can
 * never drift apart. Returns null for an unknown subject (department
 * deleted, person no longer flagged) or an unsupported subject/metric pair
 * (person + success_rate) — callers treat null as "skip, don't throw" per
 * the spec's edge-case handling, not as a crash.
 */
export function metricValueOf(agg: AiInsightAggregate, subjectType: RecoSubjectType, subjectKey: string, metricKey: InsightMetricKey): number | null {
  if (subjectType === "company") return agg.companyMetrics[metricKey] ?? null;
  if (subjectType === "department") {
    const d = agg.departmentsAll.find((d) => d.departmentId === subjectKey);
    return d ? (d.metrics[metricKey] ?? null) : null;
  }
  if (subjectType === "person") {
    if (metricKey === "success_rate") return null; // unsupported — person has no rate, only counts
    return agg.personMetricsAll.get(subjectKey)?.[metricKey] ?? null;
  }
  return null;
}

/**
 * Reads 100% of the company's task + report data (every department, every
 * person, no date-range slice) and reduces it to a compact, bounded summary
 * — the thing that actually goes in the OpenAI prompt. The reduction step
 * (counting/sorting/capping) is a plain DB query + in-memory loop, not an AI
 * call, so it costs nothing beyond what the dashboard already spends; only
 * the final `flagged` list (capped at `MAX_PEOPLE_PER_GROUP` names per
 * bucket) is what actually reaches the model, which is what keeps token
 * cost roughly constant regardless of company size (see AI-Insight report).
 */
export async function buildAiInsightAggregate(orgId: string): Promise<AiInsightAggregate> {
  const [{ tasks }, reportFeed, directory, departmentRows] = await Promise.all([
    readTasks(orgId),
    readStore<{ topics?: ReportTopic[]; posts?: ReportPost[] }>(orgId, "report-feed"),
    listDirectory(orgId),
    listDepartmentsWithOverlay(orgId),
  ]);

  const topics = reportFeed.data?.topics ?? [];
  const posts = reportFeed.data?.posts ?? [];
  const nameOf = new Map(directory.map((u) => [u.id, u.name] as const));
  const deptNameOf = new Map(departmentRows.map((d) => [d.id, d.name] as const));

  const taskBuckets = taskKpiBuckets(tasks as Task[]);
  const byAssignee = taskBucketsByAssignee(tasks as Task[]);

  const reportByUser = reportStatusCountsByUserServer(topics, posts, null, directory);
  const reportBuckets = finalizeReport(reportByUser);

  const flagged: FlaggedGroup[] = [];
  const taskLabels: Record<"overdue" | "pending" | "lateDone", string> = {
    overdue: "งานเลยกำหนด",
    pending: "งานยังไม่เสร็จ (ในกำหนด)",
    lateDone: "งานเสร็จช้ากว่ากำหนด",
  };
  for (const key of ["overdue", "pending", "lateDone"] as const) {
    const count = taskBuckets[key];
    if (count > 0) {
      flagged.push({ key, domain: "task", label: taskLabels[key], count, people: topPeopleOf(byAssignee[key], nameOf) });
    }
  }

  const reportBucketOf = (field: keyof ReportStatusCounts) => {
    const m = new Map<string, number>();
    for (const [id, c] of reportByUser) if (c[field] > 0) m.set(id, c[field]);
    return m;
  };
  const reportLabels: Record<"missed" | "pending" | "lateDone", string> = {
    missed: "รายงานขาดส่ง",
    pending: "รายงานยังไม่ส่ง (ในกำหนด)",
    lateDone: "รายงานส่งช้ากว่ากำหนด",
  };
  for (const field of ["missed", "pending", "lateDone"] as const) {
    const total = [...reportByUser.values()].reduce((s, c) => s + c[field], 0);
    if (total > 0) {
      flagged.push({
        key: field === "missed" ? "missed" : field,
        domain: "report",
        label: reportLabels[field],
        count: total,
        people: topPeopleOf(reportBucketOf(field), nameOf),
      });
    }
  }
  flagged.sort((a, b) => b.count - a.count);

  // Combined (task+report) success rate right now, and the projected rate
  // if the single biggest flagged group vanished entirely — e.g. flagged[0]
  // is "รายงานขาดส่ง 28 รายการ": resolving all 28 moves them from
  // missed→onTime, which doesn't change the total, only the numerator.
  const combinedTotal = taskBuckets.total + reportBuckets.total;
  const combinedDone = taskBuckets.onTime + taskBuckets.lateDone + reportBuckets.onTime + reportBuckets.lateDone;
  const combinedSuccessRate = combinedTotal ? Math.round((combinedDone / combinedTotal) * 100) : 0;
  // Only "still open" buckets (overdue/pending/missed) move the needle if
  // resolved — lateDone items are already counted in combinedDone, so
  // "fixing" one doesn't change the success rate (it'd change onTimeRate
  // instead), and including it here would double-count.
  const topOpenIssue = flagged.find((g) => g.key !== "lateDone");
  const projectedSuccessRate =
    topOpenIssue && combinedTotal
      ? Math.min(100, Math.round(((combinedDone + topOpenIssue.count) / combinedTotal) * 100))
      : null;

  const allDepartments = departmentBreakdownOf(directory, deptNameOf, byAssignee, reportByUser);
  const companyMetrics: Record<InsightMetricKey, number> = {
    ...countMetricsOf(
      { overdue: taskBuckets.overdue, pending: taskBuckets.pending, lateDone: taskBuckets.lateDone },
      { missed: reportBuckets.overdue, pending: reportBuckets.pending, lateDone: reportBuckets.lateDone }
    ),
    success_rate: combinedSuccessRate,
  };
  const personMetricsAll = personMetricsAllOf(directory, byAssignee, reportByUser);
  const urgentPeopleCount = [...personMetricsAll.values()].filter((m) => m.overdue_tasks > 0 || m.missed_reports > 0).length;

  return {
    task: taskBuckets,
    report: reportBuckets,
    totalTask: taskBuckets.total,
    totalReport: reportBuckets.total,
    flagged,
    headcount: directory.length,
    combinedSuccessRate,
    projectedSuccessRate,
    people: personBreakdownOf(flagged),
    departments: allDepartments.slice(0, MAX_DEPTS),
    departmentsAll: allDepartments,
    companyMetrics,
    personMetricsAll,
    urgentPeopleCount,
    tasks: tasks as Task[],
    topics,
    posts,
    directory,
  };
}

/** §13.3 of docs/ai-insight-v2-spec.md — the 4 KPI tiles at the top of the
 * card. Deterministic (built here from the aggregate, not asked of the
 * model) for two reasons: the labels must disambiguate `pending` vs
 * `overdue` exactly (a free-text model pick can't be trusted to always
 * phrase it this way), and the underlying counts are already computed
 * numbers — there's nothing here an LLM call would add. */
export function buildFixedStats(agg: AiInsightAggregate): AiInsightStat[] {
  return [
    { label: "คนควรคุยด่วน", count: agg.urgentPeopleCount, tone: "red" },
    { label: "งานยังไม่เสร็จ", count: agg.companyMetrics.pending_tasks, tone: "amber" },
    { label: "งานเลยกำหนด", count: agg.companyMetrics.overdue_tasks, tone: "red" },
    { label: "รายงานยังไม่ส่ง", count: agg.companyMetrics.pending_reports + agg.companyMetrics.missed_reports, tone: "blue" },
  ];
}
