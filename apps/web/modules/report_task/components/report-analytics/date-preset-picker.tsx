"use client";

import { Button } from "@/modules/report_task/components/ui/button";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { type DatePreset } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { CalendarDays, CalendarRange, CalendarClock, LayoutGrid, SlidersHorizontal } from "lucide-react";

// Daily/Weekly/Monthly are the primary report cadences — "ทั้งหมด" and
// "กำหนดเอง" (custom range) are secondary, kept as smaller options after.
const mainPresets: { id: DatePreset; label: string; icon: typeof CalendarDays }[] = [
  { id: "today", label: "รายวัน", icon: CalendarDays },
  { id: "week", label: "รายสัปดาห์", icon: CalendarRange },
  { id: "month", label: "รายเดือน", icon: CalendarClock },
];
const secondaryPresets: { id: DatePreset; label: string; icon: typeof LayoutGrid }[] = [
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
}: {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (preset: DatePreset) => void;
  onCustomRangeChange: (from: string, to: string) => void;
  variant?: "card" | "inline";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 print:hidden",
        variant === "card" && "rounded-xl border border-[var(--line)] bg-white p-2"
      )}
    >
      <div className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-soft)] p-1 max-w-full overflow-x-auto">
        {mainPresets.map((p) => {
          const Icon = p.icon;
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPresetChange(p.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all shrink-0",
                active ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="h-6 w-px bg-[var(--line)]" />

      <div className="flex items-center gap-1">
        {secondaryPresets.map((p) => {
          const Icon = p.icon;
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPresetChange(p.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active ? "bg-[var(--bg-soft)] text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <DatePickerField
            value={customFrom}
            onChange={(v) => onCustomRangeChange(v, customTo)}
            className="w-[150px] max-w-full"
          />
          <span className="text-[var(--ink-soft)] text-sm">ถึง</span>
          <DatePickerField
            value={customTo}
            onChange={(v) => onCustomRangeChange(customFrom, v)}
            className="w-[150px] max-w-full"
            minDate={customFrom || undefined}
          />
        </div>
      )}

      {preset !== "all" && (
        <Button variant="ghost" size="sm" className="ml-auto text-[var(--ink-soft)]" onClick={() => onPresetChange("all")}>
          ล้างตัวกรอง
        </Button>
      )}
    </div>
  );
}
