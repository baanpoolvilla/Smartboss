import { isLate } from "@/modules/report_task/lib/reports";
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
    if (t.status === "done") {
      const late = t.completedAt ? new Date(t.completedAt).getTime() > new Date(t.dueDate).getTime() : false;
      if (late) lateDone += 1;
      else onTime += 1;
    } else if (isLate(t)) {
      overdue += 1;
    } else {
      pending += 1;
    }
  }
  return finalize(onTime, lateDone, pending, overdue, 0);
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
