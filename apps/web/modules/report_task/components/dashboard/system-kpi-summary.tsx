"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Props as RechartsLabelProps } from "recharts/types/component/Label";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD_STATIC } from "@/modules/report_task/components/dashboard/dashboard-card-style";
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
import { ArrowUp, ArrowDown, Minus, Gauge, AlertTriangle, ListChecks, MessageSquareText } from "lucide-react";
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

/** Task/Report share one consistent color each across the whole chart — the
 * legend pill, both bars, the tooltip dots, and the detail rows below all
 * read off these same two constants, so the pairing never drifts out of sync
 * as the component grows. Distinct from the 4 status colors (green/amber/red)
 * used elsewhere on the Dashboard, so "which series is this bar" never gets
 * confused with "which status is this bar." Raw hex (not the CSS vars these
 * used to point at) — the vars land on muted, low-chroma tones that read as
 * near-identical dark blobs at bar-chart scale; these two are a validated
 * high-chroma pair instead (`validate_palette.js` — CVD ΔE 30.6, normal-vision
 * ΔE 40.6, both well past the 8/15 floors) so the two series stay obviously
 * different colors, not just technically-distinguishable ones. */
const TASK_COLOR = "#16a34a";
const REPORT_COLOR = "#7c3aed";
const TASK_TINT = `color-mix(in srgb, ${TASK_COLOR} 12%, var(--bg))`;
const REPORT_TINT = `color-mix(in srgb, ${REPORT_COLOR} 12%, var(--bg))`;

interface KpiGroup {
  key: "onTime" | "lateDone" | "pending" | "overdue";
  label: string;
  task: number;
  taskPercent: number;
  report: number;
  reportPercent: number;
}

/** §2.5 tiering, reused for both the badge and its color — same >=80/>=50
 * thresholds the old "สุขภาพ" gauge used, driven directly by the combined
 * successRate instead of a separate averaged score. */
function tierFor(successRate: number): { label: string; color: string; bg: string } {
  if (successRate >= 80) return { label: "ดีเยี่ยม", color: "var(--brand-green-dark)", bg: "bg-green-50" };
  if (successRate >= 50) return { label: "ต้องระวัง", color: "var(--chart-amber-dark)", bg: "bg-amber-50" };
  return { label: "วิกฤต", color: "var(--chart-red-dark)", bg: "bg-red-50" };
}

function GroupedBarTooltip({ active, payload }: { active?: boolean; payload?: { payload: KpiGroup }[] }) {
  if (!active || !payload?.length) return null;
  const g = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[13px] shadow-[0_8px_24px_-8px_rgba(17,17,17,0.22)] max-w-[220px]">
      <p className="font-semibold text-[var(--ink)]">{g.label}</p>
      <p className="flex items-center gap-1.5 text-[var(--ink-soft)]">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: TASK_COLOR }} />
        งาน {g.task} งาน ({g.taskPercent}%)
      </p>
      <p className="flex items-center gap-1.5 text-[var(--ink-soft)]">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: REPORT_COLOR }} />
        รายงาน {g.report} ครั้ง ({g.reportPercent}%)
      </p>
    </div>
  );
}

/** Small count label rendered above each bar — recharts passes x/y/width of
 * the bar itself, this just centers a number just above it. Renders "0" too
 * (checking `value == null` rather than truthiness) — a silently blank label
 * above a flat bar reads as "this group forgot its count," not "the count is
 * zero," which is exactly the gap that made the Report side of this chart
 * look broken instead of just genuinely empty. */
function BarValueLabel({ x, y, width, value }: RechartsLabelProps) {
  if (x === undefined || y === undefined || width === undefined || value == null) return null;
  const nx = Number(x);
  const ny = Number(y);
  const nw = Number(width);
  return (
    <text x={nx + nw / 2} y={ny - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)">
      {value}
    </text>
  );
}

/**
 * "KPI รวมของระบบ (Task + Report)" — กราฟแท่งเทียบคู่ Task vs Report ต่อสถานะ
 * (ตรงเวลา / เสร็จช้า / ยังไม่เสร็จ ในกำหนด / ยังไม่เสร็จ เลยกำหนด — §0.1
 * เดียวกับสองการ์ด Overview ด้านล่าง) แทนโดนัทรวมวงเดียวแบบเดิม — จุดที่โดนัท
 * เดิมตอบไม่ได้ในแวบแรกคือ "Task กับ Report ใครแย่กว่ากัน" ต้องคลิกเข้าไปดู
 * ก่อนถึงจะรู้ แท่งคู่เห็นตรงๆ ในแวบเดียวว่าฝั่งไหนสูง/ต่ำกว่าโดยไม่ต้องคลิก
 *
 * ตัวเลขนับ+เปอร์เซ็นต์อยู่ 2 ที่โดยตั้งใจ ไม่ซ้ำซ้อน: บนหัวแท่ง (นับดิบ) และ
 * tooltip ตอน hover (นับ+% ของแต่ละฝั่ง) — เดิมเคยมีแถวรายละเอียดครบทั้ง 4 กลุ่ม
 * x 2 ฝั่งอยู่ใต้กราฟด้วย แต่นั่นซ้ำกับสิ่งที่โดนัท "ภาพรวมงาน (Task)"/"ภาพรวม
 * รายงาน (Report)" ด้านล่างของแดชบอร์ดแสดงอยู่แล้วทั้งคู่ (คนละที่ ตัวเลขเดียวกัน
 * เป๊ะ) จึงตัดออก เหลือให้การ์ดนี้ทำหน้าที่เฉพาะที่โดนัทสองใบทำไม่ได้: ตัวเลข
 * สำเร็จรวมเดียว/ระดับ/เทรนด์ และเทียบ Task vs Report คู่กันในมุมเดียว
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

    const stuck = taskBuckets.overdue + reportBuckets.overdue + taskBuckets.pending + reportBuckets.pending;
    // 4 groups, same split as the Task/Report Overview donuts below (§0.1) —
    // kept as separate task/report counts per group (not merged into one
    // combined number) since the whole point of this redesign is comparing
    // the two sides directly instead of hiding the split behind a click.
    const groups: KpiGroup[] = [
      {
        key: "onTime",
        label: "ตรงเวลา",
        task: taskBuckets.onTime,
        taskPercent: taskBuckets.onTimeRate,
        report: reportBuckets.onTime,
        reportPercent: reportBuckets.onTimeRate,
      },
      {
        key: "lateDone",
        label: "เสร็จช้าแต่เลยกำหนด",
        task: taskBuckets.lateDone,
        taskPercent: taskBuckets.lateRate,
        report: reportBuckets.lateDone,
        reportPercent: reportBuckets.lateRate,
      },
      {
        key: "pending",
        label: "ยังไม่เสร็จ ในกำหนด",
        task: taskBuckets.pending,
        taskPercent: taskBuckets.total ? Math.round((taskBuckets.pending / taskBuckets.total) * 100) : 0,
        report: reportBuckets.pending,
        reportPercent: reportBuckets.total ? Math.round((reportBuckets.pending / reportBuckets.total) * 100) : 0,
      },
      {
        key: "overdue",
        label: "ยังไม่เสร็จ เลยกำหนด",
        task: taskBuckets.overdue,
        taskPercent: taskBuckets.overdueRate,
        report: reportBuckets.overdue,
        reportPercent: reportBuckets.overdueRate,
      },
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
      groups,
      total: combined.total,
      tier: tierFor(combined.successRate),
      successTrend: trend(combined.successRate, prevCombined?.successRate ?? null),
      worst,
      worstPercent,
    };
  }, [allTasks, topics, posts, personId, departmentId, preset, customFrom, customTo, exemptions]);

  return (
    <Card className={`${DASHBOARD_CARD_STATIC}`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Gauge className="h-4.5 w-4.5 text-[var(--ink-soft)]" />
          KPI รวมของระบบ (Task + Report)
        </CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)] mt-0.5">
          แหล่งความจริงเดียวของทั้งงานและ Report — เทียบสองฝั่งตรงๆ ให้เห็นว่าตอนนี้บริษัทกำลังไปทางไหน
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 @container">
        {data.total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-16">ยังไม่มีงานหรือรายงานในช่วงเวลานี้</p>
        ) : (
          <>
            {/* หัว — ทิศทางรวม (สำเร็จรวม % + ระดับ + เทรนด์เทียบช่วงก่อน) */}
            <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-[var(--line)]">
              <span className="text-2xl font-semibold tabular-nums">{data.combined.successRate}%</span>
              <span className="text-[13px] text-[var(--ink-soft)]">สำเร็จรวม</span>
              <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", data.tier.bg)} style={{ color: data.tier.color }}>
                {data.tier.label}
              </span>
              <TrendText trend={data.successTrend} higherIsGood={true} />
              {/* Pill badges, not bare dots — same "colored chip names the
                  series" pattern the department pie's header badge uses, so
                  the two Dashboard cards read as one consistent system
                  instead of each card inventing its own legend style. */}
              <span className="ml-auto flex items-center gap-2">
                <span
                  className="flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1"
                  style={{ backgroundColor: TASK_TINT, color: TASK_COLOR }}
                >
                  <ListChecks className="h-3 w-3" /> งาน {data.taskBuckets.total} งาน
                </span>
                <span
                  className="flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1"
                  style={{ backgroundColor: REPORT_TINT, color: REPORT_COLOR }}
                >
                  <MessageSquareText className="h-3 w-3" /> รายงาน {data.reportBuckets.total} ครั้ง
                </span>
              </span>
            </div>

            {/* กราฟแท่งเทียบคู่ */}
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.groups} margin={{ top: 20, right: 8, left: 8, bottom: 0 }} barGap={4}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--ink-soft)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--line)" }}
                    interval={0}
                  />
                  <YAxis hide />
                  <Tooltip content={<GroupedBarTooltip />} cursor={{ fill: "var(--bg-soft)" }} />
                  <Bar dataKey="task" name="งาน" fill={TASK_COLOR} radius={[5, 5, 0, 0]} maxBarSize={34}>
                    <LabelList dataKey="task" content={BarValueLabel} />
                  </Bar>
                  <Bar dataKey="report" name="รายงาน" fill={REPORT_COLOR} radius={[5, 5, 0, 0]} maxBarSize={34}>
                    <LabelList dataKey="report" content={BarValueLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
