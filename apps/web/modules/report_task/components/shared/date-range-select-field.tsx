"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/modules/report_task/components/ui/select";
import { Input } from "@/modules/report_task/components/ui/input";
import { FilterField, filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { datePresetLabels, datePresetGroups, type DatePreset } from "@/modules/report_task/lib/date-filter";
import { CalendarClock } from "lucide-react";

/**
 * The boxed "ช่วงเวลา" filter field — full 12-preset `DatePreset` dropdown +
 * custom range, in the same label-above/bordered-pill shell as every other
 * filter field. Originally the Dashboard's own inline date Select; pulled
 * out here so the Task Board (and anything else that needs the same due-date
 * filter) uses the identical control instead of a hand-copied one.
 */
export function DateRangeSelectField({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onCustomRangeChange,
  widthClass = "min-w-[130px]",
}: {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (preset: DatePreset) => void;
  onCustomRangeChange: (from: string, to: string) => void;
  widthClass?: string;
}) {
  return (
    <>
      <FilterField label="ช่วงเวลา">
        <Select value={preset} onValueChange={(v) => v && onPresetChange(v as DatePreset)}>
          <SelectTrigger className={filterFieldTriggerClass(preset !== "all", widthClass)}>
            <CalendarClock className="h-4 w-4 shrink-0" />
            <SelectValue placeholder="ช่วงเวลา">{datePresetLabels[preset]}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {datePresetGroups.map((group, i) => (
              <SelectGroup key={i}>
                {group.label && <SelectLabel>{group.label}</SelectLabel>}
                {group.presets.map((p) => (
                  <SelectItem key={p} value={p}>{datePresetLabels[p]}</SelectItem>
                ))}
                {i < datePresetGroups.length - 1 && <SelectSeparator />}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      {preset === "custom" && (
        <div className="flex items-end gap-2 flex-wrap">
          {/* `lang="en-GB"` only changes how the native picker *displays* the
              date (dd/mm/yyyy instead of the browser-default en-US
              mm/dd/yyyy) — the underlying value stays the same ISO
              "yyyy-mm-dd" string either way. */}
          <Input
            type="date"
            lang="en-GB"
            value={customFrom}
            onChange={(e) => onCustomRangeChange(e.target.value, customTo)}
            className="w-[150px] max-w-full"
          />
          <span className="text-[var(--ink-soft)] text-sm pb-2">ถึง</span>
          <Input
            type="date"
            lang="en-GB"
            value={customTo}
            onChange={(e) => onCustomRangeChange(customFrom, e.target.value)}
            className="w-[150px] max-w-full"
          />
        </div>
      )}
    </>
  );
}
