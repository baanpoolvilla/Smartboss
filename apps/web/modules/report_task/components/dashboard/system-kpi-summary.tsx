"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { DASHBOARD_CARD_STATIC } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { taskKpiBuckets, taskBucketsByAssignee, reportKpiBuckets, type KpiBucketKey } from "@/modules/report_task/lib/kpi-buckets";
import { combineKpiBuckets } from "@/modules/report_task/lib/combine-kpi-buckets";
import { previousPeriodRange, periodTrend, type Trend } from "@/modules/report_task/lib/dashboard-trend";
import { filterTasksByDashboard, presetRange } from "@/modules/report_task/lib/date-filter";
import { localDateStr } from "@/modules/report_task/lib/now";
import { getUser } from "@/modules/report_task/lib/directory";
import { reportStatusCountsByUser, scopedUserIds, type ReportStatusCounts } from "@/modules/report_task/lib/report-feed-compliance";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useVisibleReportTopics } from "@/modules/report_task/hooks/use-visible-report-topics";
import { useReportComplianceExemptions } from "@/modules/report_task/hooks/use-report-compliance-exemptions";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { ArrowUp, ArrowDown, Minus, Gauge, Lightbulb, AlertTriangle, ListChecks, MessageSquareText } from "lucide-react";
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
 * confused with "which status is this bar" — a green bar here does NOT mean
 * "good," so it deliberately avoids status-green. Pulled straight from
 * theme.css's existing categorical chart palette (`--chart-blue`/
 * `--chart-violet`, the same hues `departmentColorOrder` already cycles
 * through for the department pies) rather than new hex, so this chart reads
 * as the same visual language as the rest of the Dashboard instead of
 * introducing its own. Both cool-toned and close in saturation on purpose —
 * a calmer pairing than the loud green/purple this replaced. */
const TASK_COLOR = "#2a78d6";
const REPORT_COLOR = "#4a3aa7";
const TASK_TINT = `color-mix(in srgb, ${TASK_COLOR} 12%, var(--bg))`;
const REPORT_TINT = `color-mix(in srgb, ${REPORT_COLOR} 12%, var(--bg))`;

/** Fixed plot height (px) the hand-rolled bars scale against — replaces
 * recharts' auto-scaled YAxis, which this chart no longer has. */
const CHART_HEIGHT = 190;

/** A bar's segments cap at this many named people — beyond that the tail
 * folds into one "อื่นๆ" segment, same MAX_SLICES-then-fold pattern
 * DepartmentPieChart uses so a busy bar doesn't turn into a hairline mess. */
const MAX_SEGMENTS = 5;

interface PersonSeg {
  id: string;
  name: string;
  count: number;
}

interface KpiGroup {
  key: KpiBucketKey;
  label: string;
  task: number;
  report: number;
  taskPeople: PersonSeg[];
  reportPeople: PersonSeg[];
}

/** §2.5 tiering, reused for both the badge and its color — same >=80/>=50
 * thresholds the old "สุขภาพ" gauge used, driven directly by the combined
 * successRate instead of a separate averaged score. */
function tierFor(successRate: number): { label: string; color: string; bg: string } {
  if (successRate >= 80) return { label: "ดีเยี่ยม", color: "var(--brand-green-dark)", bg: "bg-green-50" };
  if (successRate >= 50) return { label: "ต้องระวัง", color: "var(--chart-amber-dark)", bg: "bg-amber-50" };
  return { label: "วิกฤต", color: "var(--chart-red-dark)", bg: "bg-red-50" };
}

/** `counts` (personId -> count) into the segment list one bar draws, sorted
 * biggest-first so the tallest, most-identifiable segment lands at the
 * bottom of the stack. Beyond `MAX_SEGMENTS` people the remainder folds into
 * one un-clickable "อื่นๆ" segment (no single person it could filter to). */
function topPeople(counts: Map<string, number>): PersonSeg[] {
  const entries = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, name: getUser(id)?.name ?? id, count: n }))
    .sort((a, b) => b.count - a.count);
  if (entries.length <= MAX_SEGMENTS + 1) return entries;
  const rest = entries.slice(MAX_SEGMENTS);
  return [...entries.slice(0, MAX_SEGMENTS), { id: "other", name: "อื่นๆ", count: rest.reduce((s, e) => s + e.count, 0) }];
}

/** Maps a report's 5-way status key onto the 4-group vocabulary this chart
 * (and Task's KpiBucketKey) uses — Report calls the "still open past its
 * deadline" bucket `missed`, Task calls it `overdue`; same meaning. */
const REPORT_BUCKET_FIELD: Record<KpiBucketKey, keyof ReportStatusCounts> = {
  onTime: "onTime",
  lateDone: "lateDone",
  pending: "pending",
  overdue: "missed",
};

/** One templated next-step per issue type — plain copy, not AI-generated,
 * same "rule-based, not a black box" decision as the rest of this card. */
/** Same "name the specific person when known" shape as the two Overview
 * donuts' own issueSuggestion — falls back to the generic phrasing when no
 * single person stands out (e.g. an even spread across the team). */
function issueSuggestion(key: string, personName?: string): string {
  switch (key) {
    case "taskOverdue":
      return personName
        ? `ตรวจสอบงานของ ${personName} แล้วพิจารณาจัดลำดับความสำคัญหรือมอบหมายใหม่`
        : "ตรวจสอบว่าใครดูแลงานเหล่านี้อยู่ แล้วพิจารณาจัดลำดับความสำคัญหรือมอบหมายใหม่";
    case "reportOverdue":
      return personName
        ? `ส่งข้อความเตือน ${personName} ก่อนกลายเป็นค้างสะสมหลายวัน`
        : "ส่งข้อความเตือนคนที่เกี่ยวข้อง ก่อนกลายเป็นค้างสะสมหลายวัน";
    case "taskPending":
      return personName
        ? `ติดตามความคืบหน้าของ ${personName} ก่อนถึงกำหนด ป้องกันไม่ให้เลื่อนไปเป็นเลยกำหนด`
        : "ติดตามความคืบหน้าก่อนถึงกำหนด ป้องกันไม่ให้เลื่อนไปเป็นเลยกำหนด";
    default:
      return personName
        ? `เตือน ${personName} ล่วงหน้าก่อนถึงเวลาปิดรอบ เพื่อลดโอกาสขาดส่ง`
        : "เตือนล่วงหน้าก่อนถึงเวลาปิดรอบ เพื่อลดโอกาสขาดส่ง";
  }
}

/** Whoever contributes the most to `map` — named, same helper shape as the
 * two Overview donuts use for their own "ตัวปัญหาหลัก". */
function topPersonOf(map: Map<string, number>): { name: string; count: number } | undefined {
  const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return undefined;
  return { name: getUser(top[0])?.name ?? top[0], count: top[1] };
}

/**
 * One bar (either the "งาน" or "รายงาน" side of a group) split into one
 * segment per person, tallest at the bottom. Hover reveals a name+count
 * tooltip (`group/seg`, pure CSS — no position tracking needed since the
 * tooltip is anchored inside the segment it belongs to); clicking a segment
 * toggles that person as the Dashboard's person filter, same
 * click-to-filter/click-again-to-clear pattern as DepartmentPieChart. The
 * folded "อื่นๆ" segment isn't one real person, so it's inert — hoverable for
 * its combined count, but not clickable.
 */
function StatusBar({
  color,
  total,
  max,
  people,
  seriesLabel,
  activePersonId,
  onPick,
}: {
  color: string;
  total: number;
  max: number;
  people: PersonSeg[];
  seriesLabel: string;
  activePersonId: string;
  onPick: (id: string) => void;
}) {
  const heightPct = max ? Math.min(100, (total / max) * 100) : 0;
  return (
    <div className="flex h-full w-8 flex-col items-center justify-end">
      <span className="mb-1 text-[11px] font-bold tabular-nums text-[var(--ink)]">{total}</span>
      <div className="flex w-full flex-col-reverse" style={{ height: `${heightPct}%` }}>
        {people.length === 0 ? (
          <div className="w-full flex-1 rounded-t-[5px]" style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, var(--bg))` }} />
        ) : (
          people.map((p, i) => {
            const isOther = p.id === "other";
            const isActive = activePersonId === p.id;
            const isTop = i === people.length - 1;
            // Real, opaque shades (color-mix toward white), not opacity —
            // opacity fades toward whatever sits behind the bar, which
            // washed out the validated task/report hues against the white
            // card. "อื่นๆ" mixes toward --chart-gray instead of continuing
            // the rank ramp, so it reads as "not a real person" rather than
            // just the palest segment.
            const mixPct = isOther ? 45 : Math.max(40, 100 - i * 15);
            const mixTarget = isOther ? "var(--chart-gray)" : "#ffffff";
            const segColor = `color-mix(in srgb, ${color} ${mixPct}%, ${mixTarget})`;
            return (
              <button
                key={p.id}
                type="button"
                disabled={isOther}
                onClick={() => onPick(p.id)}
                aria-pressed={isActive}
                aria-label={`${p.name} — ${p.count} ${seriesLabel}${isActive ? " (กำลังกรองอยู่ คลิกเพื่อยกเลิก)" : ""}`}
                className={cn(
                  "group/seg relative w-full flex-1 border-t border-white/70 first:border-t-0",
                  isTop && "rounded-t-[5px]",
                  isOther ? "cursor-default" : "cursor-pointer hover:brightness-90"
                )}
                style={{ backgroundColor: segColor, flexGrow: p.count, flexBasis: 0 }}
              >
                {isActive && <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white" />}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-max -translate-x-1/2 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-left text-[12px] shadow-[0_8px_24px_-8px_rgba(17,17,17,0.22)] group-hover/seg:block">
                  <span className="block font-semibold text-[var(--ink)]">{p.name}</span>
                  <span className="text-[var(--ink-soft)]">
                    {seriesLabel} {p.count} รายการ
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
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
  // Only relevant when `data.tiedIssues` has more than one entry (a real
  // tie at the top, not just "several issues exist") — see the "+N
  // เพิ่มเติม" toggle below.
  const [showAllMainIssues, setShowAllMainIssues] = useState(false);
  const allTasks = useVisibleTasks();
  const topics = useVisibleReportTopics();
  const posts = useReportFeedStore((s) => s.posts);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);
  const setPersonId = useDashboardFilterStore((s) => s.setPersonId);
  const exemptions = useReportComplianceExemptions();

  const data = useMemo(() => {
    const currentRange = presetRange(preset, customFrom, customTo);
    const prevRange = previousPeriodRange(preset, customFrom, customTo);
    const scope = { personId, departmentId };

    const taskCohort = (opts: { preset: typeof preset; customFrom: string; customTo: string }) =>
      filterTasksByDashboard(allTasks, { personId, departmentId, ...opts });

    const currentTasks = taskCohort({ preset, customFrom, customTo });
    const taskBuckets = taskKpiBuckets(currentTasks);
    const prevTaskBuckets = prevRange
      ? taskKpiBuckets(taskCohort({ preset: "custom", customFrom: localDateStr(prevRange.from), customTo: localDateStr(prevRange.to) }))
      : null;

    const reportBuckets = reportKpiBuckets(topics, posts, currentRange, scope, exemptions);
    const prevReportBuckets = prevRange ? reportKpiBuckets(topics, posts, prevRange, scope, exemptions) : null;

    const combined = combineKpiBuckets(taskBuckets, reportBuckets);
    const prevCombined = prevTaskBuckets && prevReportBuckets ? combineKpiBuckets(prevTaskBuckets, prevReportBuckets) : null;
    const trend = (curr: number, prev: number | null) => (prev === null ? null : periodTrend(curr, prev));

    // Per-person breakdown behind each bar — who actually makes up "5 งาน
    // เลยกำหนด" — scoped the same way the totals above already are (a
    // department/person filter narrows `currentTasks`/the report side alike)
    // so a segment's count always matches what that filter would show.
    const taskByAssignee = taskBucketsByAssignee(currentTasks);
    const reportByUserAll = reportStatusCountsByUser(topics, posts, currentRange, exemptions);
    const inScope = scopedUserIds(scope);
    function reportPeopleFor(key: KpiBucketKey): PersonSeg[] {
      const field = REPORT_BUCKET_FIELD[key];
      const counts = new Map<string, number>();
      for (const id of inScope) {
        const n = reportByUserAll.get(id)?.[field] ?? 0;
        if (n > 0) counts.set(id, n);
      }
      return topPeople(counts);
    }

    // 4 groups, same split as the Task/Report Overview donuts below (§0.1) —
    // kept as separate task/report counts per group (not merged into one
    // combined number) since the whole point of this redesign is comparing
    // the two sides directly instead of hiding the split behind a click.
    // Ordered เสร็จ ก่อน ไม่เสร็จ (ซ้าย→ขวา) ให้ตรงกับเส้นแบ่งกลางที่คั่นระหว่าง
    // "เสร็จช้า/ตรงเวลา" (ฝั่งเสร็จ) กับ "เลยกำหนด/ยังไม่เสร็จในกำหนด" (ฝั่งไม่เสร็จ) —
    // ตำแหน่งนี้ผูกกับ index 1/2 ด้านล่างที่ใช้วางเส้นแบ่งกลาง ถ้าสลับลำดับต้องย้ายเส้นตาม
    const groups: KpiGroup[] = (["lateDone", "onTime", "overdue", "pending"] as const).map((key) => ({
      key,
      label: { overdue: "เลยกำหนด", pending: "ยังไม่เสร็จ ในกำหนด", lateDone: "เสร็จช้าแต่เลยกำหนด", onTime: "ตรงเวลา" }[key],
      task: taskBuckets[key],
      report: reportBuckets[key],
      taskPeople: topPeople(taskByAssignee[key]),
      reportPeople: reportPeopleFor(key),
    }));

    // §2.4's "ตัวปัญหาหลัก" — ชี้เฉพาะก้อนที่หนักสุด (เดี่ยว เว้นแต่เท่ากันจริง
    // ก็โชว์ทุกก้อนที่เท่ากันนั้น ไม่ใช่สุ่มเลือกก้อนใดก้อนหนึ่ง) พร้อมชื่อคนที่
    // ทำให้เกิดก้อนนั้นมากที่สุด — เหมือนกับที่สองโดนัท Overview ด้านล่างทำ
    // ก้อนที่ไม่ติดอันดับสูงสุดไม่แสดงเลย (ไม่ใช่แค่พับซ่อน) ตาม §2.4 เดิม.
    const reportPersonCounts = (field: "missed" | "pending") => {
      const m = new Map<string, number>();
      for (const id of inScope) {
        const n = reportByUserAll.get(id)?.[field] ?? 0;
        if (n > 0) m.set(id, n);
      }
      return m;
    };
    const ranked = [
      { key: "taskOverdue", label: "งานเลยกำหนด", count: taskBuckets.overdue, person: topPersonOf(taskByAssignee.overdue) },
      { key: "reportOverdue", label: "รายงานขาดส่ง", count: reportBuckets.overdue, person: topPersonOf(reportPersonCounts("missed")) },
      { key: "taskPending", label: "งานยังไม่เสร็จ (ในกำหนด)", count: taskBuckets.pending, person: topPersonOf(taskByAssignee.pending) },
      {
        key: "reportPending",
        label: "รายงานยังไม่ส่ง (ในกำหนด)",
        count: reportBuckets.pending,
        person: topPersonOf(reportPersonCounts("pending")),
      },
    ]
      .filter((i) => i.count > 0)
      .sort((a, b) => b.count - a.count);
    const topIssueCount = ranked[0]?.count;
    const tiedIssues = ranked.filter((i) => i.count === topIssueCount);

    return {
      taskBuckets,
      reportBuckets,
      combined,
      groups,
      maxBar: Math.max(1, ...groups.flatMap((g) => [g.task, g.report])),
      total: combined.total,
      tier: tierFor(combined.successRate),
      successTrend: trend(combined.successRate, prevCombined?.successRate ?? null),
      tiedIssues,
    };
  }, [allTasks, topics, posts, personId, departmentId, preset, customFrom, customTo, exemptions]);

  function pickPerson(id: string) {
    if (id === "other") return;
    setPersonId(personId === id ? "all" : id);
  }

  return (
    // overflow-visible overrides the base Card's overflow-hidden (there for
    // rounding image corners, irrelevant here) — without it, a person
    // tooltip on a near-full-height bar gets clipped by the card's own
    // rounded edge instead of floating above it.
    <Card className={cn(DASHBOARD_CARD_STATIC, "overflow-visible")}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Gauge className="h-4.5 w-4.5 text-[var(--ink-soft)]" />
          KPI รวมของระบบ (Task + Report)
        </CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)] mt-0.5">
          แหล่งความจริงเดียวของทั้งงานและ Report — เทียบสองฝั่งตรงๆ ให้เห็นว่าตอนนี้บริษัทกำลังไปทางไหน · แต่ละแท่งแยกเป็นปล่องรายคน
          ชี้เพื่อดูชื่อ คลิกเพื่อกรองทั้งแดชบอร์ดเฉพาะคนนั้น (คลิกซ้ำเพื่อยกเลิก)
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

            {/* กราฟแท่งเทียบคู่ — แบ่งครึ่งซ้าย "เสร็จ" (เสร็จช้า/ตรงเวลา) กับครึ่งขวา
                "ยังไม่เสร็จ" (เลยกำหนด/ยังไม่เสร็จในกำหนด) ด้วยเส้นประกลาง ให้เห็นสัดส่วนงาน
                จบแล้ว vs ค้างในแวบเดียว ไม่ต้องอ่านทีละแท่ง — แต่ละแท่งแตกเป็นปล่องรายคน
                แทนสีทึบก้อนเดียว (hand-rolled แทน recharts เพราะจำนวนปล่อง/คนต่อแท่งไม่คงที่
                recharts' stacked Bar ต้องรู้ dataKey ตายตัวล่วงหน้า ใช้ไม่ได้กับ shape แบบนี้) */}
            <div className="flex text-[11px] font-medium text-[var(--ink-soft)] px-2">
              <span className="flex-1 text-center">เสร็จ</span>
              <span className="flex-1 text-center">ยังไม่เสร็จ</span>
            </div>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-[var(--line)]" />
              <div className="flex items-stretch pt-6" style={{ height: CHART_HEIGHT + 24 }}>
                {data.groups.map((g) => (
                  <div key={g.key} className="flex h-full flex-1 items-end justify-center gap-1.5">
                    <StatusBar
                      color={TASK_COLOR}
                      total={g.task}
                      max={data.maxBar}
                      people={g.taskPeople}
                      seriesLabel="งาน"
                      activePersonId={personId}
                      onPick={pickPerson}
                    />
                    <StatusBar
                      color={REPORT_COLOR}
                      total={g.report}
                      max={data.maxBar}
                      people={g.reportPeople}
                      seriesLabel="รายงาน"
                      activePersonId={personId}
                      onPick={pickPerson}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex px-1">
              {data.groups.map((g) => (
                <div key={g.key} className="flex-1 text-center text-[11px] leading-tight text-[var(--ink-soft)]">
                  {g.label}
                </div>
              ))}
            </div>

            {data.tiedIssues.length > 0 && (
              <div className="w-full flex flex-col gap-2">
                {(showAllMainIssues ? data.tiedIssues : data.tiedIssues.slice(0, 1)).map((issue) => (
                  <div key={issue.key} className="flex flex-col gap-2">
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-[var(--chart-red-dark)] shrink-0 mt-0.5" />
                      <p className="text-[12px] text-[var(--ink)]">
                        <span className="font-semibold text-[var(--chart-red-dark)]">ตัวปัญหาหลัก:</span> {issue.label}
                        {issue.person ? (
                          <>
                            {" — "}
                            <span className="font-medium">{issue.person.name}</span> ({issue.person.count} รายการ)
                          </>
                        ) : (
                          <> {issue.count} ครั้ง</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                      <Lightbulb className="h-4 w-4 text-[var(--chart-amber-dark)] shrink-0 mt-0.5" />
                      <p className="text-[12px] text-[var(--ink-soft)]">{issueSuggestion(issue.key, issue.person?.name)}</p>
                    </div>
                  </div>
                ))}
                {data.tiedIssues.length > 1 && (
                  <button
                    onClick={() => setShowAllMainIssues((v) => !v)}
                    className="self-start text-[11.5px] font-semibold text-[var(--brand-green-dark)] hover:underline"
                  >
                    {showAllMainIssues ? "ย่อกลับ" : `+${data.tiedIssues.length - 1} เพิ่มเติม (จำนวนเท่ากัน)`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
