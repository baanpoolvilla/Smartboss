"use client";

import { useMemo, type ReactNode } from "react";
import { Card, CardContent } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD_STATIC } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { overallKpis } from "@/modules/report_task/lib/reports";
import { complianceKpisForScope } from "@/modules/report_task/lib/report-feed-compliance";
import { previousPeriodRange, periodTrend, type Trend } from "@/modules/report_task/lib/dashboard-trend";
import { filterTasksByDashboard, presetRange, datePresetLabels } from "@/modules/report_task/lib/date-filter";
import { localDateStr } from "@/modules/report_task/lib/now";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { ListTodo, CheckCircle2, Clock, AlertTriangle, MessageSquareText, FileClock, KanbanSquare, Info } from "lucide-react";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/** "ครั้ง" isn't self-explanatory on its own (it's people × days, not a headcount) — this ⓘ spells it out with a worked example, once per group, right where the confusion happens. */
function ReportCountInfo() {
  return (
    <Popover>
      <PopoverTrigger
        className="shrink-0 text-[var(--ink-soft)] hover:text-[var(--brand-green-dark)]"
        aria-label="ตัวเลขในกลุ่ม Report นับยังไง"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-xs space-y-1.5">
        <p className="font-semibold">ตรงเวลา / ช้า / ไม่ได้ส่ง นับยังไง</p>
        <p className="text-[var(--ink-soft)]">
          นับ 1 ครั้ง ต่อ &ldquo;1 คน ที่ควรส่งรายงาน 1 วัน&rdquo; เฉพาะห้องที่ตั้งรอบเวลา (cutoff) ไว้เท่านั้น — 3 คนไม่ส่งวันเดียวกัน = 3
          ครั้ง หรือ 1 คนไม่ส่งติดต่อกัน 3 วัน = 3 ครั้ง เช่นกัน
        </p>
        <p className="text-[var(--ink-soft)]">&ldquo;โพสต์ Report ทั้งหมด&rdquo; นับต่างออกไป — เป็นจำนวนโพสต์จริง ไม่ใช่ครั้งที่ควรส่ง</p>
      </PopoverContent>
    </Popover>
  );
}

function GroupLabel({ icon: Icon, label, info }: { icon: typeof KanbanSquare; label: string; info?: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)] uppercase tracking-wide mb-3">
      <Icon className="h-3.5 w-3.5" /> {label}
      {info}
    </p>
  );
}

function TrendChip({ trend, higherIsGood }: { trend: Trend | null; higherIsGood: boolean | null }) {
  // preset is "ทั้งหมด" — there's no "previous all-time" to compare against, so don't pretend there is.
  if (!trend) {
    return <span className="text-[13px] text-[var(--ink-soft)]">ไม่เทียบช่วงเวลา (เลือก &ldquo;ทั้งหมด&rdquo;)</span>;
  }
  if (trend.direction === "flat" || trend.percent === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-[var(--ink-soft)]">
        <Minus className="h-3 w-3" /> คงที่เทียบช่วงก่อนหน้า
      </span>
    );
  }
  const rose = trend.direction === "up";
  // Neutral metrics (higherIsGood === null) always render gray; otherwise
  // green/red is picked by whether this rise is actually good news.
  const good = higherIsGood === null ? null : rose === higherIsGood;
  const colorClass = good === null ? "text-[var(--ink-soft)]" : good ? "text-[var(--brand-green-dark)]" : "text-[var(--chart-red)]";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[13px] font-medium", colorClass)}>
      {rose ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(trend.percent)}% เทียบช่วงก่อนหน้า
    </span>
  );
}

/**
 * The Executive KPI row — 6 large cards answering "how many tasks/reports
 * exist, how many are done, what needs attention" at a glance. Follows the
 * Dashboard's own date filter (DashboardFilters, right above this row) like
 * every other widget on the page — "วันนี้" shows today's numbers,
 * "สัปดาห์นี้" shows this week's, etc. — instead of a trend stuck comparing
 * fixed weeks no matter what the filter bar says. The trend chip compares
 * against the immediately-preceding period of the same length (see
 * previousPeriodRange); "ทั้งหมด" has no such period, so its trend is omitted.
 */
export function ExecutiveKpiRow() {
  const allTasks = useVisibleTasks();
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const exemptions = useReportComplianceExemptions();

  const cards = useMemo(() => {
    const currentRange = presetRange(preset, customFrom, customTo);
    const prevRange = previousPeriodRange(preset, customFrom, customTo);
    const periodLabel = datePresetLabels[preset];

    const currentTasks = overallKpis(
      filterTasksByDashboard(allTasks, { personId, departmentId, priority: "all", preset, customFrom, customTo })
    );
    const prevTasks = prevRange
      ? overallKpis(
          filterTasksByDashboard(allTasks, {
            personId,
            departmentId,
            priority: "all",
            preset: "custom",
            customFrom: localDateStr(prevRange.from),
            customTo: localDateStr(prevRange.to),
          })
        )
      : null;

    const currentReports = complianceKpisForScope(topics, posts, currentRange, { personId, departmentId }, exemptions);
    const prevReports = prevRange
      ? complianceKpisForScope(topics, posts, prevRange, { personId, departmentId }, exemptions)
      : null;

    const taskTrend = (curr: number, prev: number | null) => (prev === null ? null : periodTrend(curr, prev));

    return [
      {
        group: "task" as const,
        label: "งานทั้งหมด",
        value: currentTasks.total,
        subtitle: `งานทั้งหมด (${periodLabel})`,
        icon: ListTodo,
        accent: "border-t-[var(--chart-blue)]",
        iconClass: "bg-blue-50 text-[var(--chart-blue)]",
        trend: taskTrend(currentTasks.total, prevTasks?.total ?? null),
        higherIsGood: null,
      },
      {
        group: "task" as const,
        label: "เสร็จสิ้น",
        value: currentTasks.completed,
        subtitle: `อัตราความสำเร็จ ${currentTasks.completionRate}%`,
        icon: CheckCircle2,
        accent: "border-t-[var(--brand-green)]",
        iconClass: "bg-green-50 text-[var(--brand-green)]",
        trend: taskTrend(currentTasks.completed, prevTasks?.completed ?? null),
        higherIsGood: true,
      },
      {
        group: "task" as const,
        label: "กำลังทำ",
        value: currentTasks.inProgress,
        subtitle: "งานที่กำลังดำเนินการ",
        icon: Clock,
        accent: "border-t-[var(--chart-amber)]",
        iconClass: "bg-amber-50 text-[var(--chart-amber)]",
        trend: taskTrend(currentTasks.inProgress, prevTasks?.inProgress ?? null),
        higherIsGood: null,
      },
      {
        group: "task" as const,
        label: "เลยกำหนด",
        value: currentTasks.late,
        subtitle: currentTasks.late > 0 ? "ต้องเร่งติดตาม" : "ทุกงานตรงเวลา",
        icon: AlertTriangle,
        accent: "border-t-[var(--chart-red)]",
        iconClass: "bg-red-50 text-[var(--chart-red)]",
        trend: taskTrend(currentTasks.late, prevTasks?.late ?? null),
        higherIsGood: false,
      },
      {
        group: "report" as const,
        label: "โพสต์ Report ทั้งหมด",
        value: currentReports.totalPosts,
        subtitle: `โพสต์ Report (${periodLabel})`,
        icon: MessageSquareText,
        accent: "border-t-[var(--chart-violet)]",
        iconClass: "bg-violet-50 text-[var(--chart-violet)]",
        trend: taskTrend(currentReports.totalPosts, prevReports?.totalPosts ?? null),
        higherIsGood: true,
      },
      {
        group: "report" as const,
        label: "ตรงเวลา",
        value: currentReports.onTimeCount,
        unit: currentReports.onTimeCount > 0 ? "ครั้ง" : "",
        subtitle: `ส่งก่อนรอบเวลาสุดท้าย (${periodLabel})`,
        icon: CheckCircle2,
        accent: "border-t-[var(--brand-green)]",
        iconClass: "bg-green-50 text-[var(--brand-green)]",
        trend: taskTrend(currentReports.onTimeCount, prevReports?.onTimeCount ?? null),
        higherIsGood: true,
      },
      {
        group: "report" as const,
        label: "ส่งช้า",
        value: currentReports.lateCount,
        unit: currentReports.lateCount > 0 ? "ครั้ง" : "",
        subtitle: `ส่งหลังรอบเวลาสุดท้าย (${periodLabel})`,
        icon: Clock,
        accent: "border-t-[var(--chart-amber)]",
        iconClass: "bg-amber-50 text-[var(--chart-amber)]",
        trend: taskTrend(currentReports.lateCount, prevReports?.lateCount ?? null),
        higherIsGood: false,
      },
      {
        group: "report" as const,
        label: "ไม่ได้ส่ง",
        value: currentReports.missedCount,
        unit: currentReports.missedCount > 0 ? "ครั้ง" : "",
        subtitle: currentReports.missedCount > 0 ? `รวมทุกคนที่ขาดส่งของทั้งบริษัท (${periodLabel})` : "ไม่มีใครขาดส่งเลย",
        icon: FileClock,
        accent: "border-t-[var(--chart-red)]",
        iconClass: "bg-red-50 text-[var(--chart-red)]",
        trend: taskTrend(currentReports.missedCount, prevReports?.missedCount ?? null),
        higherIsGood: false,
      },
    ];
  }, [allTasks, topics, posts, personId, departmentId, preset, customFrom, customTo, exemptions]);

  const taskCards = cards.filter((c) => c.group === "task");
  const reportCards = cards.filter((c) => c.group === "report");

  function renderCard(c: (typeof cards)[number]) {
    return (
      <Card key={c.label} className={cn(DASHBOARD_CARD_STATIC, "border-t-[3px]", c.accent)}>
        <CardContent className="flex items-start justify-between gap-3 px-5 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--ink-soft)]">{c.label}</p>
            <p className="text-3xl leading-tight font-semibold tracking-tight mt-1 tabular-nums">
              {c.value}
              {"unit" in c && c.unit && <span className="text-sm font-medium text-[var(--ink-soft)] ml-1">{c.unit}</span>}
            </p>
            <p className="text-[12px] text-[var(--ink-soft)] mt-1">{c.subtitle}</p>
            <div className="mt-2">
              <TrendChip trend={c.trend} higherIsGood={c.higherIsGood} />
            </div>
          </div>
          <div className={cn("h-10 w-10 rounded-2xl flex items-center justify-center shrink-0", c.iconClass)}>
            <c.icon className="h-4.5 w-4.5" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-soft)]/50 p-4">
        <GroupLabel icon={KanbanSquare} label="ภาพรวมงาน (Task)" />
        <div className="grid grid-cols-2 gap-4">{taskCards.map(renderCard)}</div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-soft)]/50 p-4">
        <GroupLabel icon={MessageSquareText} label="ภาพรวม Report" info={<ReportCountInfo />} />
        <div className="grid grid-cols-2 gap-4">{reportCards.map(renderCard)}</div>
      </div>
    </div>
  );
}
