"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD_STATIC } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { ChartTooltip } from "@/modules/report_task/components/shared/chart-tooltip";
import { taskKpiBuckets, reportKpiBuckets } from "@/modules/report_task/lib/kpi-buckets";
import { combineKpiBuckets } from "@/modules/report_task/lib/combine-kpi-buckets";
import { previousPeriodRange, periodTrend, type Trend } from "@/modules/report_task/lib/dashboard-trend";
import { filterTasksByDashboard, presetRange } from "@/modules/report_task/lib/date-filter";
import { localDateStr } from "@/modules/report_task/lib/now";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useHasHover } from "@/modules/report_task/hooks/use-has-hover";
import { ArrowUp, ArrowDown, Minus, Gauge, AlertTriangle } from "lucide-react";
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
      {good ? "ดีขึ้น" : "แย่ลง"} {Math.abs(trend.percent)}% จากช่วงก่อนหน้า
    </span>
  );
}

interface KpiSlice {
  key: "onTime" | "lateDone" | "pending" | "overdue";
  label: string;
  value: number;
  color: string;
  /** How much of `value` is Task's vs Report's — shown on hover so "whose is
   * this" is answered without needing a per-person/department drill-down. */
  taskValue: number;
  reportValue: number;
}

/** §2.5 tiering, reused for both the badge under the donut and its color —
 * same >=80/>=50 thresholds the old "สุขภาพ" gauge used, now driven directly
 * by the combined successRate instead of a separate averaged score. */
function tierFor(successRate: number): { label: string; color: string; bg: string } {
  if (successRate >= 80) return { label: "ดีเยี่ยม", color: "var(--brand-green-dark)", bg: "bg-green-50" };
  if (successRate >= 50) return { label: "ต้องระวัง", color: "var(--chart-amber-dark)", bg: "bg-amber-50" };
  return { label: "วิกฤต", color: "var(--chart-red-dark)", bg: "bg-red-50" };
}

// Recharts hands this function a props object that includes a `key` —
// spreading that straight into JSX triggers React's "key must be passed
// directly" warning, so it's pulled out and passed on its own instead.
function renderActiveShape({ key, ...props }: PieSectorDataItem & { key?: React.Key | null }) {
  return <Sector key={key} {...props} outerRadius={(props.outerRadius ?? 0) + 4} />;
}

/**
 * "KPI รวมของระบบ (Task + Report)" — one combined donut + proportional bar,
 * both built from the exact same 4-group breakdown (ตรงเวลา / เสร็จช้า /
 * ยังไม่เสร็จ ในกำหนด / ยังไม่เสร็จ เลยกำหนด — same §0.1 split the Task/Report
 * Overview donuts below use, kept separate rather than merged into one
 * "ยังค้าง" slice so all three cards agree at a glance). "ยกเว้น" is still
 * left out entirely, same reasoning as the Overview donuts: excluded from
 * every rate already, so showing it as a 5th slice on equal footing just
 * reads as confusing. Numbers live in exactly one place each: the legend
 * for counts, the donut center for whatever's currently selected — never
 * inside the bar itself.
 *
 * Hover and click do different things (§3): hover only ever shows a
 * tooltip, never changes state. Click drills the donut's center into that
 * segment (dims the rest) and is what a touch tap does too, since without a
 * hover a tap has to double as both "peek" and "select" — nothing here
 * navigates away on a single tap, so there's no need for the two-step
 * pin-then-navigate pattern other Dashboard charts use.
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
  const hasHover = useHasHover();
  const [selectedKey, setSelectedKey] = useState<KpiSlice["key"] | null>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);

  const data = useMemo(() => {
    const currentRange = presetRange(preset, customFrom, customTo);
    const prevRange = previousPeriodRange(preset, customFrom, customTo);
    const scope = { personId, departmentId };

    const taskCohort = (opts: { preset: typeof preset; customFrom: string; customTo: string }) =>
      filterTasksByDashboard(allTasks, { personId, departmentId, ...opts });

    const taskBuckets = taskKpiBuckets(taskCohort({ preset, customFrom, customTo }));
    const prevTaskBuckets = prevRange
      ? taskKpiBuckets(taskCohort({ preset: "custom", customFrom: localDateStr(prevRange.from), customTo: localDateStr(prevRange.to) }))
      : null;

    const reportBuckets = reportKpiBuckets(topics, posts, currentRange, scope, exemptions);
    const prevReportBuckets = prevRange ? reportKpiBuckets(topics, posts, prevRange, scope, exemptions) : null;

    const combined = combineKpiBuckets(taskBuckets, reportBuckets);
    const prevCombined = prevTaskBuckets && prevReportBuckets ? combineKpiBuckets(prevTaskBuckets, prevReportBuckets) : null;
    const trend = (curr: number, prev: number | null) => (prev === null ? null : periodTrend(curr, prev));

    const stuck = combined.pending + combined.overdue;
    // 4 groups, same split as the Task/Report Overview donuts below (§0.1) —
    // "ยังค้าง" as one merged slice was tried first, but it disagreed with
    // those two cards showing pending/overdue separately right underneath
    // it, so this went back to matching them exactly.
    const slices: KpiSlice[] = [
      { key: "onTime", label: "ตรงเวลา", value: combined.onTime, color: "var(--chart-green-dark)", taskValue: taskBuckets.onTime, reportValue: reportBuckets.onTime },
      { key: "lateDone", label: "เสร็จช้า", value: combined.lateDone, color: "var(--chart-green-light)", taskValue: taskBuckets.lateDone, reportValue: reportBuckets.lateDone },
      { key: "pending", label: "ยังไม่เสร็จ ในกำหนด", value: combined.pending, color: "var(--chart-amber)", taskValue: taskBuckets.pending, reportValue: reportBuckets.pending },
      { key: "overdue", label: "ยังไม่เสร็จ เลยกำหนด", value: combined.overdue, color: "var(--chart-red)", taskValue: taskBuckets.overdue, reportValue: reportBuckets.overdue },
    ];

    // §2.4's "ตัวปัญหาหลัก" — whichever of Task-overdue/Report-overdue is
    // bigger, as a share of everything still stuck (pending+overdue
    // combined). Not shown at all once there's nothing stuck.
    const worst =
      taskBuckets.overdue >= reportBuckets.overdue
        ? { label: "งานเลยกำหนด", count: taskBuckets.overdue }
        : { label: "รายงานขาดส่ง", count: reportBuckets.overdue };
    const worstPercent = stuck ? Math.round((worst.count / stuck) * 100) : 0;

    return {
      taskBuckets,
      reportBuckets,
      combined,
      slices,
      total: combined.total,
      tier: tierFor(combined.successRate),
      successTrend: trend(combined.successRate, prevCombined?.successRate ?? null),
      worst,
      worstPercent,
    };
  }, [allTasks, topics, posts, personId, departmentId, preset, customFrom, customTo, exemptions]);

  // Tap outside the donut+bar area clears the drill-down (§3, mobile only —
  // desktop's only way back to the overview is clicking the center itself).
  useEffect(() => {
    if (hasHover || selectedKey === null) return;
    const onOutside = (e: PointerEvent) => {
      if (!chartAreaRef.current?.contains(e.target as Node)) setSelectedKey(null);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [hasHover, selectedKey]);

  // Clicking the already-selected segment again toggles back to the
  // overview — the same spot that drilled in is what backs out, so there's
  // no need to hunt for the center specifically (still works too, as a
  // second way back).
  function selectSegment(key: KpiSlice["key"]) {
    setSelectedKey((prev) => (prev === key ? null : key));
  }

  const selected = selectedKey ? data.slices.find((s) => s.key === selectedKey) ?? null : null;
  const selectedPercent = selected && data.total ? Math.round((selected.value / data.total) * 100) : 0;

  return (
    <Card className={`${DASHBOARD_CARD_STATIC}`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Gauge className="h-4.5 w-4.5 text-[var(--ink-soft)]" />
          KPI รวมของระบบ (Task + Report)
        </CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)] mt-0.5">แหล่งความจริงเดียวของทั้งงานและ Report</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 @container">
        {data.total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-16">ยังไม่มีงานหรือรายงานในช่วงเวลานี้</p>
        ) : (
          <div ref={chartAreaRef} className="flex flex-col @sm:flex-row items-center @sm:items-stretch gap-5 @sm:gap-8">
            {/* LEFT — full donut, click a slice (or the legend/bar) to drill
                its center into that one segment; click the center again to
                go back to the overview. */}
            <div className="flex flex-col items-center justify-center shrink-0 @sm:pr-8 @sm:border-r @sm:border-[var(--line)]">
              <div className="h-[200px] w-[200px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.slices.filter((s) => s.value > 0)}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={66}
                      outerRadius={96}
                      paddingAngle={2}
                      cornerRadius={5}
                      stroke="#ffffff"
                      strokeWidth={2}
                      isAnimationActive
                      animationDuration={500}
                      activeShape={renderActiveShape}
                    >
                      {data.slices
                        .filter((s) => s.value > 0)
                        .map((s) => (
                          <Cell
                            key={s.key}
                            fill={s.color}
                            opacity={selectedKey && selectedKey !== s.key ? 0.25 : 1}
                            cursor="pointer"
                            onClick={() => selectSegment(s.key)}
                            tabIndex={0}
                            role="button"
                            aria-label={`${s.label} — ${s.value} รายการ`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                selectSegment(s.key);
                              }
                            }}
                            style={{ transition: "opacity 0.15s ease" }}
                          />
                        ))}
                    </Pie>
                    <Tooltip
                      trigger={hasHover ? "hover" : "click"}
                      content={
                        <ChartTooltip<KpiSlice>
                          renderRow={(s) => ({
                            color: s.color,
                            title: s.label,
                            lines: [
                              `${s.value} รายการ · ${data.total ? Math.round((s.value / data.total) * 100) : 0}%`,
                              `งาน ${s.taskValue} · รายงาน ${s.reportValue}`,
                            ],
                          })}
                        />
                      }
                      wrapperStyle={{ zIndex: 50, outline: "none" }}
                      allowEscapeViewBox={{ x: true, y: true }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {selected ? (
                  <button
                    onClick={() => setSelectedKey(null)}
                    aria-label="กลับไปดูภาพรวม"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[62%] w-[62%] flex flex-col items-center justify-center rounded-full outline-none cursor-pointer"
                  >
                    {/* Just the percent here — the count, and the
                        Task/Report split, are one hover away (the same
                        tooltip content the bar and the pie's own hover
                        already show), not permanently taking up room in a
                        circle this small. */}
                    <span className="text-3xl font-semibold tabular-nums leading-tight" style={{ color: selected.color }}>
                      {selectedPercent}%
                    </span>
                    {/* line-clamp-2, not truncate — "ยังไม่เสร็จ เลยกำหนด"
                        cut to one line always ended mid-word with "…", which
                        read as broken rather than just tight. Wrapping to a
                        second line uses the same space more honestly. */}
                    <span className="text-[11px] text-[var(--ink-soft)] leading-snug mt-1 line-clamp-2 text-center max-w-[85%]">
                      {selected.label}
                    </span>
                  </button>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-4xl font-semibold tabular-nums leading-tight">{data.combined.successRate}%</span>
                    <span className="text-[12px] text-[var(--ink-soft)] leading-tight mt-0.5">สำเร็จ</span>
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", data.tier.bg)}
                  style={{ color: data.tier.color }}
                >
                  {data.tier.label}
                </span>
                <TrendText trend={data.successTrend} higherIsGood={true} />
              </div>
            </div>

            {/* RIGHT — proportional bar (no numbers on it) + legend (every
                count lives here, once) + the biggest-backlog callout. */}
            <div className="flex-1 w-full flex flex-col justify-center gap-2.5 min-w-0">
              <span className="text-sm font-semibold">ภาพรวมทั้งหมด</span>
              <KpiBar slices={data.slices} total={data.total} selectedKey={selectedKey} onSelect={selectSegment} hasHover={hasHover} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {data.slices.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => selectSegment(s.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[12px] rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-[var(--bg-soft)]",
                      selectedKey && selectedKey !== s.key && "opacity-40"
                    )}
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[var(--ink)]">{s.label}</span>
                    <span className="text-[var(--ink-soft)] tabular-nums">{s.value}</span>
                  </button>
                ))}
              </div>
              {data.worst.count > 0 && (
                <div className="w-full flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-[var(--chart-red-dark)] shrink-0 mt-0.5" />
                  <p className="text-[12px] text-[var(--chart-red-dark)]">
                    <span className="font-semibold">ตัวปัญหาหลัก:</span> {data.worst.label} {data.worst.count} ครั้ง ({data.worstPercent}%
                    ของงานค้างทั้งหมด)
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Proportional bar, no text inside it — every segment's own count lives in
 * the legend below instead (§2). Hover only shows a tooltip; click selects
 * the same way the donut's slices do (shared `selectedKey`), so the two
 * stay in sync regardless of which one was interacted with. */
function KpiBar({
  slices,
  total,
  selectedKey,
  onSelect,
  hasHover,
}: {
  slices: KpiSlice[];
  total: number;
  selectedKey: KpiSlice["key"] | null;
  onSelect: (key: KpiSlice["key"]) => void;
  hasHover: boolean;
}) {
  const visible = slices.filter((s) => s.value > 0);
  if (total === 0 || visible.length === 0) {
    return <div className="h-[18px] rounded-full bg-[var(--bg-soft)]" />;
  }
  return (
    <div className="h-[18px] w-full flex overflow-hidden rounded-full">
      {visible.map((s) => {
        const fraction = s.value / total;
        const percent = Math.round(fraction * 100);
        const dimmed = selectedKey !== null && selectedKey !== s.key;
        return (
          <button
            key={s.key}
            onClick={() => onSelect(s.key)}
            className="group relative h-full shrink-0 transition-opacity hover:opacity-85 focus-visible:opacity-85 outline-none"
            style={{ width: `${fraction * 100}%`, backgroundColor: s.color, opacity: dimmed ? 0.25 : 1 }}
            aria-label={`${s.label} ${s.value} · ${percent}% · งาน ${s.taskValue} · รายงาน ${s.reportValue}`}
          >
            {/* Same white-card look as ChartTooltip (used by the pie right
                above, and every Overview donut below) — this bar isn't a
                Recharts element so it can't reuse that component directly,
                but matching its classes keeps every hover tooltip on the
                Dashboard looking like one system instead of two. */}
            <span
              className={cn(
                "pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+6px)] whitespace-nowrap rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[13px] text-left shadow-[0_8px_24px_-8px_rgba(17,17,17,0.22)] transition-opacity z-10",
                hasHover
                  ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  : selectedKey === s.key
                    ? "opacity-100"
                    : "opacity-0"
              )}
            >
              <span className="flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
              <span className="block text-[var(--ink-soft)]">
                {s.value} · {percent}%
              </span>
              <span className="block text-[var(--ink-soft)]">
                งาน {s.taskValue} · รายงาน {s.reportValue}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
