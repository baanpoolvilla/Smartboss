import "server-only";

import { readTasks } from "@/modules/report_task/lib/db/task-repo";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listDirectory, type DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
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
function mustReportToTopicServer(visibility: ReportTopic["visibility"], user: DirectoryUser): boolean {
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
  const [{ tasks }, reportFeed, directory] = await Promise.all([
    readTasks(orgId),
    readStore<{ topics?: ReportTopic[]; posts?: ReportPost[] }>(orgId, "report-feed"),
    listDirectory(orgId),
  ]);

  const topics = reportFeed.data?.topics ?? [];
  const posts = reportFeed.data?.posts ?? [];
  const nameOf = new Map(directory.map((u) => [u.id, u.name] as const));

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

  return {
    task: taskBuckets,
    report: reportBuckets,
    totalTask: taskBuckets.total,
    totalReport: reportBuckets.total,
    flagged,
    headcount: directory.length,
    combinedSuccessRate,
    projectedSuccessRate,
  };
}
