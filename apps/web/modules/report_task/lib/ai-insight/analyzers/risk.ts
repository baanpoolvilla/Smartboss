import "server-only";

import { trackedTopicsOf, dayComplianceStatus } from "@/modules/report_task/lib/report-feed-compliance";
import { mustReportToTopicServer, type AiInsightAggregate } from "../aggregate";
import type { RiskItem } from "../types";

/** "About to become overdue" window — matches the spec's "48 ชม. ข้างหน้า". */
const WINDOW_DAYS = 2;
const MAX_RISKS = 10;

function daysUntil(dueDateStr: string, now: Date): number {
  const d = new Date(dueDateStr);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const todayMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - todayMidnight) / (1000 * 60 * 60 * 24));
}

/** §16.3 of docs/ai-insight-v2-spec.md — "still on time today, but about to
 * flip to overdue" — the early-warning list, distinct from `flagged` (which
 * is already-overdue). Not left to the model: due dates are exact data, not
 * something worth spending a token guessing about.
 *
 * The report half is a simplification vs. the spec's literal "iteration
 * deadline within window" — this checks whether TODAY's compliance status is
 * still "pending" (in-deadline, not yet posted) per topic, which is the
 * same "about to become missed" signal without needing to re-derive each
 * topic's own next cutoff date here. */
export function detectRisks(agg: AiInsightAggregate, now: Date): RiskItem[] {
  const risks: RiskItem[] = [];

  for (const t of agg.tasks) {
    if (t.status === "done") continue;
    const days = daysUntil(t.dueDate, now);
    if (days >= 0 && days <= WINDOW_DAYS) {
      risks.push({ name: t.title, kind: "task", count: 1, dueInDays: days });
    }
  }

  const todayStr = now.toISOString().slice(0, 10);
  for (const topic of trackedTopicsOf(agg.topics)) {
    let pendingCount = 0;
    for (const u of agg.directory) {
      if (u.isOwner) continue;
      if (!mustReportToTopicServer(topic.visibility, u)) continue;
      if (dayComplianceStatus(topic, u.id, todayStr, agg.posts) === "pending") pendingCount += 1;
    }
    if (pendingCount > 0) {
      risks.push({ name: topic.name, kind: "report", count: pendingCount, dueInDays: 0 });
    }
  }

  risks.sort((a, b) => a.dueInDays - b.dueInDays || b.count - a.count);
  return risks.slice(0, MAX_RISKS);
}
