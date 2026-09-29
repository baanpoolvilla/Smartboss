import { isLate } from "@/modules/report_task/lib/reports";
import { finishedTaskOnTime } from "@/modules/report_task/lib/task-penalty-sweep";
import { daysUntil } from "@/modules/report_task/lib/format";
import { reportStatusCountsForScope } from "@/modules/report_task/lib/report-feed-compliance";
import type { DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { Task } from "@/modules/report_task/types";

/**
 * The one shared status-bucket shape for both Task and Report (§0.1 of
 * DASHBOARD_REDESIGN_PROMPT.md) — every dashboard number (KPI card, the two
 * Overview donuts, the 4 backlog cells) is built from this, so they can
 * never disagree with each other.
 *
 * 5 groups, deliberately never merged:
 *   1. onTime   — finished/sent, before the deadline           (green, dark)
 *   2. lateDone — finished/sent, but after the deadline         (green, light)
 *   3. pending  — not finished/sent yet, still within deadline  (amber)
 *   4. overdue  — not finished/sent, deadline has passed        (red)
 *   5. exempt   — excluded from KPI entirely                    (gray)
 *
 * Group 2 and group 4 look similar ("late" vs "overdue") but are NOT the
 * same thing — group 2 is a closed, finished item; group 4 is still an open
 * problem. Collapsing them into one "late" bucket is exactly the semantic
 * bug this file exists to fix.
 *
 * `total` = groups 1+2+3+4 only — group 5 (exempt) is excluded from every
 * rate's denominator, same as it's excluded from tracked days elsewhere.
 */
export interface KpiBuckets {
  onTime: number;
  lateDone: number;
  pending: number;
  overdue: number;
  exempt: number;
  total: number;
  /** (onTime + lateDone) ÷ total × 100 — "got it done at all," late or not. */
  successRate: number;
  /** onTime ÷ total × 100 — stricter than successRate, excludes late-done. */
  onTimeRate: number;
  lateRate: number;
  overdueRate: number;
}

function finalize(onTime: number, lateDone: number, pending: number, overdue: number, exempt: number): KpiBuckets {
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

export type KpiBucketKey = "onTime" | "lateDone" | "pending" | "overdue";

/** Single source of truth for which of the 4 groups one task falls into —
 * shared by `taskKpiBuckets` (aggregate count) and `taskBucketsByAssignee`
 * (per-person breakdown) so the two can never disagree on where a task
 * lands. */
export function taskBucketOf(t: Task): KpiBucketKey {
  if (t.status === "done") {
    // กติกาเดียวกับตอนหักคะแนนส่งช้า (เลื่อนกำหนดรายคน/เลื่อนก่อนครบกำหนด/ส่งในวันครบกำหนด)
    // ไม่งั้นกราฟบอก "เสร็จช้า" ทั้งที่ระบบไม่หักคะแนน · งานกลุ่ม: มีใครสักคนโดนหักส่งช้า = ทั้งงานเสร็จช้า
    if (t.taskMode === "group" && hasLateDock(t)) return "lateDone";
    return finishedTaskOnTime(t) ? "onTime" : "lateDone";
  }
  return isLate(t) ? "overdue" : "pending";
}

function hasLateDock(t: Task): boolean {
  return Object.keys(t.penalties ?? {}).length > 0;
}

/**
 * กลุ่มของ "คนหนึ่งคน" ในงานนั้น — งานเดี่ยวเท่ากับของทั้งงาน งานกลุ่มตัดสินรายคน
 *
 * เดิมงานกลุ่มทุกคนได้ผลเดียวกับทั้งงาน ⇒ คนเดียวส่งช้า (ภีม) ทั้งทีมขึ้น "เสร็จช้า" หมด
 * ทั้งที่คนอื่นเลื่อนกำหนดกันไว้แล้ว (T-2569-0028) · ไม่มีเวลาที่แต่ละคนกดเสร็จเก็บไว้
 * จึงใช้คำตัดสินรายคนที่ sweep บันทึกไว้แล้ว: `penalties[คนนั้น]` = เลยกำหนดของตัวเอง
 * ขณะส่วนของตัวเองยังไม่เสร็จ (sweep เทียบกับกำหนดรายคน assigneeDueDates ทุก 60 วินาที)
 */
export function taskAssigneeBucketOf(t: Task, assigneeId: string): KpiBucketKey {
  if (t.taskMode !== "group") return taskBucketOf(t);
  const docked = !!t.penalties?.[assigneeId];
  const partDone = t.status === "done" || (t.completedAssigneeIds ?? []).includes(assigneeId);
  if (partDone) {
    if (docked) return "lateDone";
    // ข้อมูลเก่าก่อนมีการหักรายคน: ไม่มีใครโดนหักเลยแต่ทั้งงานปิดช้า — ใช้ผลของทั้งงาน
    if (t.status === "done" && !hasLateDock(t) && !finishedTaskOnTime(t)) return "lateDone";
    return "onTime";
  }
  if (docked) return "overdue";
  return daysUntil(t.assigneeDueDates?.[assigneeId] ?? t.dueDate) < 0 ? "overdue" : "pending";
}

/**
 * Task's 5-group bucket. Group 5 (ยกเว้น/ยกเลิก) is always 0 — nothing in the
 * Task schema can mark a task cancelled/excluded from KPI today (no
 * `cancelled` status, no exemption flag, unlike Report's DateExemptions).
 * Decided explicitly rather than guessed at a schema addition — see the
 * conversation this file was built in. Revisit if/when a real "cancel a
 * task" feature exists.
 */
export function taskKpiBuckets(tasks: Task[]): KpiBuckets {
  let onTime = 0;
  let lateDone = 0;
  let pending = 0;
  let overdue = 0;
  for (const t of tasks) {
    const bucket = taskBucketOf(t);
    if (bucket === "onTime") onTime += 1;
    else if (bucket === "lateDone") lateDone += 1;
    else if (bucket === "overdue") overdue += 1;
    else pending += 1;
  }
  return finalize(onTime, lateDone, pending, overdue, 0);
}

/** Same 4 groups as `taskKpiBuckets`, but split by assignee instead of
 * summed — one count per person per group. A group task counts once for
 * *each* of its assignees (not split fractionally), each judged on their own
 * part — see `taskAssigneeBucketOf`. */
export function taskBucketsByAssignee(tasks: Task[]): Record<KpiBucketKey, Map<string, number>> {
  const out: Record<KpiBucketKey, Map<string, number>> = {
    onTime: new Map(),
    lateDone: new Map(),
    pending: new Map(),
    overdue: new Map(),
  };
  for (const t of tasks) {
    for (const assigneeId of t.assigneeIds) {
      const bucket = taskAssigneeBucketOf(t, assigneeId);
      out[bucket].set(assigneeId, (out[bucket].get(assigneeId) ?? 0) + 1);
    }
  }
  return out;
}

/** Report's 5-group bucket — built on `reportStatusCountsForScope`, which
 * already tracks per-day on-time/late/pending/missed/exempt via the same
 * `dayComplianceStatus` every other report-feed number is derived from. */
export function reportKpiBuckets(
  topics: ReportTopic[],
  posts: ReportPost[],
  range: { from: Date; to: Date } | null,
  scope: { personId: string; departmentId: string },
  exemptions?: DateExemptions
): KpiBuckets {
  const c = reportStatusCountsForScope(topics, posts, range, scope, exemptions);
  return finalize(c.onTime, c.lateDone, c.pending, c.missed, c.exempt);
}
