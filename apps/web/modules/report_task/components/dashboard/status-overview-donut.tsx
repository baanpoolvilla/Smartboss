"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { DASHBOARD_CARD } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { ChartTooltip } from "@/modules/report_task/components/shared/chart-tooltip";
import type { KpiBuckets } from "@/modules/report_task/lib/kpi-buckets";
import { useHasHover } from "@/modules/report_task/hooks/use-has-hover";
import { cn, pickDaily } from "@/modules/report_task/lib/utils";
import { periodTrend } from "@/modules/report_task/lib/dashboard-trend";
import { TrendText, tierFor } from "@/modules/report_task/components/shared/trend-badge";
import type { RankedPerson } from "@/modules/report_task/lib/ranked-people";
import { Lightbulb, AlertTriangle } from "lucide-react";

/** Same templated, rule-based (not AI-generated) next-step copy as the KPI
 * card's own "ตัวปัญหาหลัก" — generic enough to read naturally for either
 * domain (งาน/รายงาน) since this component is shared by both. Deliberately
 * NOT personalized — "ตัวปัญหาหลัก" above already names whoever's involved,
 * so this line stays a general next step rather than repeating one name
 * when several people can be tied there at once. Grounded in actual
 * workload-management/deadline-compliance practice (capacity-aware
 * reassignment, weekly backlog reviews, visible/shared tracking, reminders
 * that state *why* the deadline matters) instead of generic-sounding filler
 * — see the research this list was built from, linked in the PR. Rotated
 * by `pickDaily` so it doesn't read as the exact same static sentence on
 * every single visit. */
const ISSUE_TIPS = {
  overdue: [
    "มอบหมายต่อให้คนที่มีคิวว่างและทักษะตรงกับงานนั้นจริงๆ ไม่ใช่ใครก็ได้ที่ว่าง",
    "ทบทวนงานค้างเป็นประจำทุกสัปดาห์ ดูว่าอะไรติดขัดก่อนจะกองสะสมนานขึ้น",
    "จัดลำดับใหม่ตามผลกระทบจริง ไม่ใช่แค่ตัวที่ค้างนานสุดต้องมาก่อนเสมอ",
  ],
  pending: [
    "ใช้บอร์ดที่ทุกคนเห็นร่วมกัน งานที่มองเห็นได้ทั่วทีมมักถูกดูแลดีกว่า",
    "ให้เพื่อนร่วมทีมช่วยเช็คความคืบหน้ากันเอง ไม่ต้องรอหัวหน้าถามอย่างเดียว",
    "เตือนก่อนถึงกำหนดพร้อมบอกว่าทำไมงานนี้สำคัญ ไม่ใช่แค่แจ้งวันที่เฉยๆ",
  ],
} as const;
function issueSuggestion(key: "overdue" | "pending"): string {
  return pickDaily(ISSUE_TIPS[key]);
}

interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  percent: number;
}

// Recharts hands this function a props object that includes a `key` —
// spreading that straight into JSX triggers React's "key must be passed
// directly" warning, so it's pulled out and passed on its own instead.
function renderActiveShape({ key, ...props }: PieSectorDataItem & { key?: React.Key | null }) {
  return <Sector key={key} {...props} outerRadius={(props.outerRadius ?? 0) + 4} />;
}

/**
 * The shared shape behind both Overview donuts (§2.6) — Task and Report must
 * look identical structurally, differing only in wording, so this is the one
 * component both `task-status-pie.tsx` and `report-feed-status-pie.tsx`
 * render, each just passing their own buckets/labels/click handler.
 */
export function StatusOverviewDonut({
  title,
  subtitle,
  icon,
  buckets,
  labels,
  unitLabel,
  centerLabel,
  totalLabel,
  emptyMessage,
  topPersonByBucket,
  prevSuccessRate,
  peopleByBucket,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  buckets: KpiBuckets;
  labels: { onTime: string; lateDone: string; pending: string; overdue: string; exempt: string };
  /** e.g. "งาน" / "ครั้ง" — the count noun used in the pie tooltip's first
   * line ("14 งาน · 25%"), matching how the KPI card's own tooltip reads
   * ("23 รายการ · 12%") instead of a bare, unit-less number. */
  unitLabel: string;
  /** e.g. "สำเร็จ" — sits under the big % in the donut's center, and labels
   * the onTime+lateDone subtotal row atop the legend. */
  centerLabel: string;
  /** e.g. "68 งาน" / "90 ครั้ง" — the footer's "ทั้งหมด/ต้องส่ง {totalLabel}". */
  totalLabel: string;
  emptyMessage: string;
  /** Whoever contributes the most to the overdue/pending bucket, so
   * "ตัวปัญหาหลัก" can name specific people instead of just a bucket total —
   * every entry tied for the top count (not just one), sorted, computed by
   * the caller (TaskStatusPie/ReportFeedStatusPie) since they're the ones
   * with access to per-assignee data, not this shared shell. */
  topPersonByBucket?: Partial<Record<"overdue" | "pending", { name: string; count: number }[]>>;
  /** Same successRate from the previous period, for the tier+trend row —
   * null/omitted when there's nothing to compare against (unbounded "ทั้งหมด"
   * preset, or the previous period had zero total). Computed by the caller
   * since it needs the previous period's own bucket, not just this one. */
  prevSuccessRate?: number | null;
  /** Full ranked (biggest-first, folded beyond a cap) person list for each
   * of the 4 slices — swapped in for the legend when that slice is clicked,
   * so drilling into "ยังไม่เสร็จ เลยกำหนด" shows *who*, not just the % again.
   * Colored with the clicked slice's own color, never a fixed color, so
   * green stays green and red stays red regardless of which slice it is. */
  peopleByBucket?: Partial<Record<"onTime" | "lateDone" | "pending" | "overdue", RankedPerson[]>>;
}) {
  // "ยกเว้น" (leave/holiday-exempt) isn't shown here — mixed in with the
  // on-time/late/pending/overdue spectrum it reads as a 5th outcome on equal
  // footing with the others, which is confusing when it's actually "this
  // day didn't count at all." `buckets.total` already excludes it, so
  // leaving it out of both the pie and the legend keeps every percentage
  // here reading as a share of "days that counted."
  const raw: Slice[] = [
    { key: "onTime", label: labels.onTime, value: buckets.onTime, color: "var(--chart-green-dark)", percent: 0 },
    { key: "lateDone", label: labels.lateDone, value: buckets.lateDone, color: "var(--chart-green-light)", percent: 0 },
    { key: "pending", label: labels.pending, value: buckets.pending, color: "var(--chart-amber)", percent: 0 },
    { key: "overdue", label: labels.overdue, value: buckets.overdue, color: "var(--chart-red)", percent: 0 },
  ];
  const denom = buckets.total;
  const withPercent = raw.map((s) => ({ ...s, percent: denom ? Math.round((s.value / denom) * 100) : 0 }));
  // The pie itself only draws non-zero groups (a 0-width wedge can't be
  // rendered or clicked), but the legend lists every group regardless — "0"
  // is still an answer, not nothing to say.
  const slices = withPercent.filter((s) => s.value > 0);

  const hasHover = useHasHover();
  // Click drills the center into that one segment (dims the rest) instead
  // of navigating away immediately — same interaction as the KPI card's own
  // donut. Clicking the same segment again, or the center itself, goes back
  // to the overview; "ดูรายละเอียด" inside the drilled-in center is what
  // actually navigates now.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  function selectSegment(key: string) {
    setSelectedKey((prev) => (prev === key ? null : key));
  }
  // Tap outside the donut+legend clears the drill-down (mobile only —
  // desktop's only way back is clicking the center itself).
  useEffect(() => {
    if (hasHover || selectedKey === null) return;
    const onOutside = (e: PointerEvent) => {
      if (!chartRef.current?.contains(e.target as Node)) setSelectedKey(null);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [hasHover, selectedKey]);

  const selected = selectedKey ? slices.find((s) => s.key === selectedKey) ?? null : null;

  // "ตัวปัญหาหลัก" — one category (whichever of overdue/pending is bigger),
  // scoped to this one donut's own domain. When several people are tied for
  // the most in that category, all of them are named, not just one — the
  // "+N เพิ่มเติม" toggle expands the name list, not a second category.
  const mainIssue: { key: "overdue" | "pending"; label: string; count: number } | undefined = [
    { key: "overdue" as const, label: labels.overdue, count: buckets.overdue },
    { key: "pending" as const, label: labels.pending, count: buckets.pending },
  ]
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count)[0];
  const people = mainIssue ? (topPersonByBucket?.[mainIssue.key] ?? []) : [];
  const [showAllPeople, setShowAllPeople] = useState(false);
  const shownPeople = showAllPeople ? people : people.slice(0, 1);

  // Same tier+trend row as the KPI card's own header — a rate-based badge,
  // so it only applies here (not on the two count-based backlog cards,
  // which have no natural 0-100 scale to tier against).
  const tier = tierFor(buckets.successRate);
  const trend = prevSuccessRate != null ? periodTrend(buckets.successRate, prevSuccessRate) : null;

  return (
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)]">{subtitle}</p>
        {buckets.total > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", tier.bg)} style={{ color: tier.color }}>
              {tier.label}
            </span>
            <TrendText trend={trend} higherIsGood={true} />
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5 @container">
        {buckets.total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] text-center py-16">{emptyMessage}</p>
        ) : (
          <>
            {/* @container, not `sm:` — this card can be resized to span 1/3
                of the grid via "ปรับแต่ง", and a viewport breakpoint has no
                idea the card itself might only be ~350px wide regardless of
                how wide the browser window is. */}
            <div ref={chartRef} className="flex flex-col @sm:flex-row items-center gap-4 @sm:gap-6">
              <div className="h-[180px] w-[180px] @sm:h-[220px] @sm:w-[220px] shrink-0 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slices}
                      dataKey="value"
                      nameKey="label"
                      // Percent, not pixels — a fixed 102px outerRadius (sized
                      // for the @sm:220px box) has a 204px diameter that
                      // overflows the 180px mobile box and gets clipped by
                      // the SVG's own edge, showing up as notches/gaps around
                      // the ring. Percent radii scale off the box's own
                      // min(width,height) at every size instead.
                      innerRadius="64%"
                      outerRadius="92%"
                      paddingAngle={2}
                      cornerRadius={5}
                      stroke="#ffffff"
                      strokeWidth={2}
                      isAnimationActive
                      animationDuration={500}
                      activeShape={renderActiveShape}
                    >
                      {slices.map((s) => (
                        <Cell
                          key={s.key}
                          fill={s.color}
                          opacity={selectedKey && selectedKey !== s.key ? 0.25 : 1}
                          cursor="pointer"
                          onClick={() => selectSegment(s.key)}
                          tabIndex={0}
                          role="button"
                          aria-label={`${s.label} — ${s.value}, ${s.percent}%`}
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
                        <ChartTooltip<Slice>
                          renderRow={(s) => ({ color: s.color, title: s.label, lines: [`${s.value} ${unitLabel} (${s.percent}%)`] })}
                        />
                      }
                      wrapperStyle={{ zIndex: 50, outline: "none" }}
                      allowEscapeViewBox={{ x: true, y: true }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {selected ? (
                  // Sized to the donut's hollow center only (innerRadius,
                  // not the full box) — anything bigger would sit on top of
                  // the ring itself and swallow clicks/hover meant for the
                  // slices underneath.
                  <button
                    onClick={() => setSelectedKey(null)}
                    aria-label="กลับไปดูภาพรวม"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[62%] w-[62%] flex flex-col items-center justify-center rounded-full outline-none cursor-pointer"
                  >
                    <span className="text-2xl font-semibold tabular-nums leading-tight" style={{ color: selected.color }}>
                      {selected.percent}%
                    </span>
                    <span className="text-[11px] text-[var(--ink-soft)] leading-snug mt-1 line-clamp-2 text-center max-w-[85%]">
                      {selected.label}
                    </span>
                  </button>
                ) : (
                  <Popover>
                    <PopoverTrigger
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[62%] w-[62%] flex flex-col items-center justify-center rounded-full outline-none cursor-help"
                      aria-label={`${centerLabel} ${buckets.successRate}% คำนวณยังไง`}
                    >
                      <span className="text-4xl font-semibold tabular-nums">{buckets.successRate}%</span>
                      <span className="text-[13px] text-[var(--ink-soft)] mt-0.5">{centerLabel}</span>
                    </PopoverTrigger>
                    <PopoverContent align="center" className="w-64 text-xs space-y-1.5">
                      <p className="font-semibold">
                        {centerLabel} {buckets.successRate}% คือ
                      </p>
                      <p className="text-[var(--ink-soft)]">
                        {labels.onTime} + {labels.lateDone} ({buckets.onTime + buckets.lateDone}) ÷ ทั้งหมด ({buckets.total})
                      </p>
                      <p className="text-[var(--ink-soft)]">
                        ตรงเวลา {buckets.onTimeRate}% · ส่งช้า {buckets.lateRate}%
                      </p>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              <div className="flex-1 w-full space-y-1.5 min-w-0">
                {selected && peopleByBucket?.[selected.key as keyof typeof peopleByBucket]?.length ? (
                  // Drilled in AND per-person data exists for this slice —
                  // swap the legend out entirely for who's actually behind
                  // it, ranked biggest-first, colored to match the clicked
                  // slice only (no leftover red/amber/green from the other
                  // 3 slices sitting around dimmed).
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-semibold text-[var(--ink-soft)] uppercase tracking-wide px-1">
                      {selected.label} — เรียงมากไปน้อย
                    </p>
                    {(() => {
                      const people = peopleByBucket[selected.key as keyof typeof peopleByBucket]!;
                      const max = people[0]?.count || 1;
                      return people.map((p, i) => (
                        <div key={p.name} className="flex items-center gap-2 px-1">
                          <span className="text-[11px] font-semibold text-[var(--ink-soft)] w-4 text-right shrink-0">{i + 1}.</span>
                          <span className="text-[12.5px] text-[var(--ink)] w-20 truncate shrink-0">{p.name}</span>
                          <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(p.count / max) * 100}%`, backgroundColor: selected.color }} />
                          </div>
                          <span className="text-[11.5px] font-semibold w-14 text-right tabular-nums shrink-0" style={{ color: selected.color }}>
                            {p.count} {unitLabel}
                          </span>
                        </div>
                      ));
                    })()}
                    <button
                      onClick={() => setSelectedKey(null)}
                      className="self-start text-[11.5px] font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)] hover:underline px-1 mt-1"
                    >
                      ‹ กลับไปดูภาพรวม
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Subtotal of the two green rows below (onTime+lateDone) —
                        same number as the donut's center %, spelled out here too
                        since a legend that lists every individual status but not
                        the headline one it sums to reads incomplete. */}
                    <div className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 bg-[var(--bg-soft)]">
                      <span className="text-sm font-semibold text-[var(--ink)]">{centerLabel}</span>
                      <span className="text-sm font-semibold text-[var(--ink)] tabular-nums shrink-0 whitespace-nowrap">
                        {buckets.onTime + buckets.lateDone} {unitLabel} ({buckets.successRate}%)
                      </span>
                    </div>
                    {withPercent.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => selectSegment(s.key)}
                        disabled={s.value === 0}
                        className={cn(
                          "w-full flex items-center justify-between text-sm gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:enabled:bg-[var(--bg-soft)] transition-colors text-left disabled:cursor-default",
                          selectedKey && selectedKey !== s.key && "opacity-40"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", s.value === 0 && "opacity-30")} style={{ backgroundColor: s.color }} />
                          <span className={cn("truncate", s.value === 0 ? "text-[var(--ink-soft)]" : "text-[var(--ink)]")}>{s.label}</span>
                        </div>
                        <span className="text-[var(--ink-soft)] tabular-nums shrink-0 whitespace-nowrap">
                          {s.value} {unitLabel} <span className="text-[var(--ink)] font-medium">({s.percent}%)</span>
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>

            {mainIssue && (
              <div className="w-full flex flex-col gap-2">
                <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-[var(--chart-red-dark)] shrink-0 mt-0.5" />
                  <div className="text-[12px] text-[var(--ink)] flex-1">
                    <p>
                      <span className="font-semibold text-[var(--chart-red-dark)]">ตัวปัญหาหลัก:</span> {mainIssue.label}
                      {shownPeople.length > 0 ? (
                        <>
                          {" — "}
                          {shownPeople.map((p, i) => (
                            <span key={p.name}>
                              {i > 0 && ", "}
                              <span className="font-medium">{p.name}</span> ({p.count} {unitLabel})
                            </span>
                          ))}
                        </>
                      ) : (
                        <> {mainIssue.count} {unitLabel}</>
                      )}
                    </p>
                    {people.length > 1 && (
                      <button
                        onClick={() => setShowAllPeople((v) => !v)}
                        className="mt-1 text-[11.5px] font-semibold text-[var(--brand-green-dark)] hover:underline"
                      >
                        {showAllPeople ? "ย่อกลับ" : `+${people.length - 1} เพิ่มเติม (จำนวนเท่ากัน)`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                  <Lightbulb className="h-4 w-4 text-[var(--chart-amber-dark)] shrink-0 mt-0.5" />
                  <p className="text-[12px] text-[var(--ink)]">
                    <span className="font-semibold text-[var(--chart-amber-dark)]">ไอเดีย:</span>{" "}
                    <span className="text-[var(--ink-soft)]">{issueSuggestion(mainIssue.key)}</span>
                  </p>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-[var(--line)]">
              {/* The ตรงเวลา/ส่งช้า rates used to repeat here too — already
                  on screen via the center-% popover above, so this just
                  says what the count is. */}
              <p className="text-[13px] text-[var(--ink-soft)]">ทั้งหมด {totalLabel}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
