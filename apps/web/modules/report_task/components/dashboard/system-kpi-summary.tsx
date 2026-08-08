"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD_STATIC } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { overallKpis } from "@/modules/report_task/lib/reports";
import { complianceKpisForScope } from "@/modules/report_task/lib/report-feed-compliance";
import { previousPeriodRange, periodTrend, type Trend } from "@/modules/report_task/lib/dashboard-trend";
import { filterTasksByDashboard, presetRange } from "@/modules/report_task/lib/date-filter";
import { localDateStr } from "@/modules/report_task/lib/now";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

function TrendText({ trend, higherIsGood }: { trend: Trend | null; higherIsGood: boolean }) {
  if (!trend || trend.direction === "flat" || trend.percent === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--ink-soft)]">
        <Minus className="h-2.5 w-2.5" /> คงที่
      </span>
    );
  }
  const rose = trend.direction === "up";
  const good = rose === higherIsGood;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", good ? "text-[var(--brand-green-dark)]" : "text-[var(--chart-red)]")}>
      {rose ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(trend.percent)}% จากช่วงก่อนหน้า
    </span>
  );
}

/**
 * "KPI รวมของระบบ (Task + Report)" — one combined card, 3 rate metrics
 * (progress bars) plus a total-backlog count, all built from real numbers
 * already computed elsewhere on this page (no invented "approval rate" —
 * there's no approval workflow in this app, so this deliberately doesn't
 * have one). Sits right under the Executive KPI groups, above the two
 * Overview donuts.
 */
export function SystemKpiSummary() {
  const allTasks = useVisibleTasks();
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const exemptions = useReportComplianceExemptions();

  const { bars, backlog, backlogTrend } = useMemo(() => {
    const currentRange = presetRange(preset, customFrom, customTo);
    const prevRange = previousPeriodRange(preset, customFrom, customTo);

    const taskCohort = (opts: { preset: typeof preset; customFrom: string; customTo: string }) =>
      filterTasksByDashboard(allTasks, { personId, departmentId, priority: "all", ...opts });

    const currentTasks = overallKpis(taskCohort({ preset, customFrom, customTo }));
    const prevTasks = prevRange
      ? overallKpis(taskCohort({ preset: "custom", customFrom: localDateStr(prevRange.from), customTo: localDateStr(prevRange.to) }))
      : null;

    const currentReports = complianceKpisForScope(topics, posts, currentRange, { personId, departmentId }, exemptions);
    const prevReports = prevRange
      ? complianceKpisForScope(topics, posts, prevRange, { personId, departmentId }, exemptions)
      : null;

    const overdueRate = currentTasks.total ? Math.round((currentTasks.late / currentTasks.total) * 100) : 0;
    const prevOverdueRate = prevTasks && prevTasks.total ? Math.round((prevTasks.late / prevTasks.total) * 100) : prevTasks ? 0 : null;

    const trend = (curr: number, prev: number | null) => (prev === null ? null : periodTrend(curr, prev));

    const bars = [
      {
        label: "อัตราสำเร็จงาน (Task)",
        value: currentTasks.completionRate,
        color: "var(--brand-green)",
        trend: trend(currentTasks.completionRate, prevTasks?.completionRate ?? null),
        higherIsGood: true,
      },
      {
        label: "อัตราส่ง Report ตรงเวลา",
        value: currentReports.complianceRate,
        color: "var(--chart-blue)",
        trend: trend(currentReports.complianceRate, prevReports?.complianceRate ?? null),
        higherIsGood: true,
      },
      {
        label: "อัตรางานเลยกำหนด",
        value: overdueRate,
        color: "var(--chart-red)",
        trend: trend(overdueRate, prevOverdueRate),
        higherIsGood: false,
      },
    ];

    const currentBacklog = currentTasks.total - currentTasks.completed + currentReports.missedCount;
    const prevBacklog = prevTasks ? prevTasks.total - prevTasks.completed + (prevReports?.missedCount ?? 0) : null;

    return { bars, backlog: currentBacklog, backlogTrend: trend(currentBacklog, prevBacklog) };
  }, [allTasks, topics, posts, personId, departmentId, preset, customFrom, customTo, exemptions]);

  return (
    <Card className={`${DASHBOARD_CARD_STATIC}`}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">KPI รวมของระบบ (Task + Report)</CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)] mt-0.5">สรุปอัตราสำคัญจากทั้งงานและ Report รวมกันในที่เดียว</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          {bars.map((b) => (
            <div key={b.label}>
              <p className="text-[13px] text-[var(--ink-soft)]">{b.label}</p>
              <p className="text-2xl font-semibold tabular-nums mt-1">{b.value}%</p>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-soft)] mt-2">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                  style={{ width: `${b.value}%`, backgroundColor: b.color }}
                />
              </div>
              <div className="mt-1.5">
                <TrendText trend={b.trend} higherIsGood={b.higherIsGood} />
              </div>
            </div>
          ))}

          <div>
            <p className="text-[13px] text-[var(--ink-soft)]">งานค้างทั้งหมด</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">{backlog}</p>
            <p className="text-[11px] text-[var(--ink-soft)] mt-2">งานที่ยังไม่เสร็จ + ครั้งที่ขาดส่งรายงาน</p>
            <div className="mt-1.5">
              <TrendText trend={backlogTrend} higherIsGood={false} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
