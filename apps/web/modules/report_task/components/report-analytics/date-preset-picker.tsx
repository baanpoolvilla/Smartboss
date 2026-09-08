"use client";

import { Button } from "@/modules/report_task/components/ui/button";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { type DatePreset } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { CalendarDays, CalendarRange, CalendarClock, LayoutGrid, SlidersHorizontal } from "lucide-react";

// One flat segmented control, not "3 primary pills + divider + 2 plain-text
// buttons" (the previous split) — that read as two different controls stuck
// together, and the divider style put every one of these on the same footing
// as a genuinely different, disjointed thing next to it. All five presets
// are the same kind of choice (which window of time), so they get the same
// pill treatment, in the order someone's most to least likely to reach for
// them.
const presets: { id: DatePreset; label: string; icon: typeof CalendarDays }[] = [
  { id: "today", label: "รายวัน", icon: CalendarDays },
  { id: "week", label: "รายสัปดาห์", icon: CalendarRange },
  { id: "month", label: "รายเดือน", icon: CalendarClock },
  { id: "all", label: "ทั้งหมด", icon: LayoutGrid },
  { id: "custom", label: "กำหนดเอง", icon: SlidersHorizontal },
];

/**
 * Pure presentational date-range picker — the same preset/custom-range UI
 * used by both the Task report filter (useReportFilterStore) and the Report
 * (report-feed) filter (useReportFeedFilterStore). Each domain keeps its own
 * store (a Task cross-filter dim doesn't mean anything for report-feed posts,
 * so they can't share one store) but both get the identical control here
 * instead of two hand-copied implementations drifting apart.
 */
export function DatePresetPicker({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onCustomRangeChange,
  /** "inline" drops the card chrome (border/bg/padding) — for a filter bar
   * that already supplies its own surface (e.g. ภาพรวมทั้งหมด's `--bg-soft`
   * strip), so it doesn't end up card-inside-a-card. */
  variant = "card",
  /** Keeps this whole control (presets + custom-range fields + "ล้างตัวกรอง")
   * on one horizontally-scrollable row instead of wrapping — for a tight
   * header strip (ภาพรวมทั้งหมด's filter row) where switching to "กำหนดเอง"
   * used to bump the row count up/down depending on which preset was picked
   * ("พอกดดูรายวันแถวเดียว พอกดดูทั้งหมดเด้งมาข้างล่างอีกแถว"). The default
   * (wrap) stays as-is for every other caller — see report-topic-panels.tsx's
   * own usage, which wants wrapping in its wider stats layout. */
  noWrap = false,
}: {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (preset: DatePreset) => void;
  onCustomRangeChange: (from: string, to: string) => void;
  variant?: "card" | "inline";
  noWrap?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 print:hidden",
        noWrap ? "flex-nowrap overflow-x-auto" : "flex-wrap",
        variant === "card" && "rounded-xl border border-[var(--line)] bg-white p-2"
      )}
    >
      <div className={cn("inline-flex items-center gap-1 rounded-lg bg-[var(--bg-soft)] p-1 max-w-full", noWrap ? "shrink-0" : "overflow-x-auto")}>
        {presets.map((p) => {
          const Icon = p.icon;
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPresetChange(p.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all shrink-0",
                // Active always reads as a white pill lifted off this
                // group's own bg-soft tray — that contrast holds regardless
                // of what surface the picker itself sits on (a white card,
                // or an already-bg-soft filter strip like ภาพรวมทั้งหมด's),
                // unlike keying the active state off the *outer* background
                // which used to go invisible whenever the two matched.
                active
                  ? "bg-[var(--brand-green)] text-white shadow-sm"
                  : "text-[var(--ink-soft)] hover:bg-white/70 hover:text-[var(--ink)]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {preset === "custom" && (
        <div className={cn("flex items-center gap-2", noWrap ? "shrink-0" : "flex-wrap")}>
          <DatePickerField
            value={customFrom}
            onChange={(v) => onCustomRangeChange(v, customTo)}
            className={cn("max-w-full", noWrap ? "w-[130px]" : "w-[150px]")}
          />
          <span className="text-[var(--ink-soft)] text-sm shrink-0">ถึง</span>
          <DatePickerField
            value={customTo}
            onChange={(v) => onCustomRangeChange(customFrom, v)}
            className={cn("max-w-full", noWrap ? "w-[130px]" : "w-[150px]")}
            minDate={customFrom || undefined}
          />
        </div>
      )}

      {preset !== "all" && (
        <Button
          variant="ghost"
          size="sm"
          className={cn("shrink-0 text-[var(--ink-soft)]", !noWrap && "ml-auto")}
          onClick={() => onPresetChange("all")}
        >
          ล้างตัวกรอง
        </Button>
      )}
    </div>
  );
}
