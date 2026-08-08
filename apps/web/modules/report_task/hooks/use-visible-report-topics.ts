"use client";

import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";

/**
 * Every report-feed room, company-wide — the same set the CEO/owner sees
 * (canSeeReportTopic has no restriction for them), used unconditionally
 * here regardless of who's actually viewing. Every consumer of this hook is
 * an aggregate analytics/dashboard widget (compliance rates, KPI cards,
 * leaderboards, the roster table) — a summary number, not room access — so
 * showing the full company picture keeps those numbers consistent for
 * everyone instead of each department head seeing a different, narrower
 * slice. This is deliberately different from the report-feed page itself,
 * which computes its own department-scoped list inline (see
 * report-feed/page.tsx's `visibleTopics`) since *that* one gates real
 * room access/posting, not just a stat.
 */
export function useVisibleReportTopics() {
  return useReportFeedStore((s) => s.topics);
}
