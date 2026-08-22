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
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { FilterField, filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { datePresetLabels, datePresetGroups, type DatePreset } from "@/modules/report_task/lib/date-filter";
import { CalendarClock, Info } from "lucide-react";

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
      <FilterField
        label="ช่วงเวลา"
        labelExtra={
          <Tooltip>
            <TooltipTrigger
              render={
                <button type="button" className="text-[var(--ink-soft)] hover:text-[var(--ink)]" aria-label="ความหมายของแต่ละช่วงเวลา">
                  <Info className="h-3 w-3" />
                </button>
              }
            />
            <TooltipContent className="max-w-[260px]">
              <b>สะสมราย(สัปดาห์/เดือน/ปี)</b> = นับตั้งแต่ต้นรอบนั้นถึง<b>วันนี้</b>เท่านั้น (รอบยังไม่จบ)
              <br />
              <b>(สัปดาห์/เดือน/ปี)นี้</b> = ทั้งรอบเต็มๆ ตั้งแต่ต้นจนจบ (รวมวันที่ยังไม่ถึงด้วย)
              <br />
              <b>(สัปดาห์/เดือน/ปี)ที่แล้ว</b> = รอบก่อนหน้าทั้งรอบ
            </TooltipContent>
          </Tooltip>
        }
      >
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* DatePickerField, not a native <input type="date"> — the native
              picker's displayed format follows the OS/browser locale
              (mm/dd/yyyy on plenty of Windows setups regardless of a `lang`
              hint), so two people on the same filter could read the same
              stored date differently. This always renders วัน/เดือน/ปี
              (Thai, dd MMM yyyy), matching every other date shown in the app. */}
          <DatePickerField value={customFrom} onChange={(v) => onCustomRangeChange(v, customTo)} className="w-[150px] max-w-full" />
          <span className="text-[var(--ink-soft)] text-sm">ถึง</span>
          <DatePickerField value={customTo} onChange={(v) => onCustomRangeChange(customFrom, v)} minDate={customFrom} className="w-[150px] max-w-full" />
        </div>
      )}
    </>
  );
}
