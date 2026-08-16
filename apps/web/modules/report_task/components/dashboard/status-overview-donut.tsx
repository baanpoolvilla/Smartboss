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
import { cn } from "@/modules/report_task/lib/utils";
import { ArrowUpRight } from "lucide-react";

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
  onSegmentClick,
  onDetail,
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
  onSegmentClick: (key: string) => void;
  /** Omit when there's nowhere useful to send "ดูรายละเอียด" — hides the footer link instead of linking somewhere confusing. */
  onDetail?: () => void;
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

  return (
    <Card className={`${DASHBOARD_CARD} h-full`}>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <p className="text-[13px] text-[var(--ink-soft)]">{subtitle}</p>
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
                      innerRadius={70}
                      outerRadius={102}
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
                    <span
                      role="link"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSegmentClick(selected.key);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onSegmentClick(selected.key);
                        }
                      }}
                      className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-[var(--brand-green-dark)] hover:underline"
                    >
                      ดูรายละเอียด <ArrowUpRight className="h-3 w-3" />
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
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--line)]">
              {/* The ตรงเวลา/ส่งช้า rates used to repeat here too — already
                  on screen via the center-% popover above, so this just
                  says what the count is. */}
              <p className="text-[13px] text-[var(--ink-soft)]">ทั้งหมด {totalLabel}</p>
              {onDetail && (
                <button onClick={onDetail} className="flex items-center gap-1 text-[13px] font-semibold text-[var(--brand-green-dark)] hover:underline shrink-0">
                  ดูรายละเอียด <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
