"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Calendar } from "@/modules/report_task/components/ui/calendar";
import { th as thDateFns } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Format this field's own `date` (built as LOCAL midnight below, to match
 * what the calendar widget highlights) using LOCAL getters. The shared
 * `formatDate` in lib/format.ts is deliberately UTC-forced for stored
 * date-only fields (dueDate etc., anchored to UTC midnight) — using it here
 * on a local-midnight Date rolls the displayed day back for positive UTC
 * offsets (e.g. Bangkok), which is the "picked 25th, shows 24th" bug.
 *
 * Numeric dd/mm/yyyy — same fixed format as every other date in report_task
 * (lib/format.ts's formatDate), not a spelled-out Thai month.
 */
function formatLocal(d: Date) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const PICKER_START = new Date(2024, 0, 1);
const PICKER_END = new Date(2036, 11, 31);

/** dd/mm/yyyy date field — replaces the native <input type="date"> whose
 *  display format follows the OS locale (mm/dd/yyyy). Value is a YYYY-MM-DD string. */
export function DatePickerField({
  value,
  onChange,
  className,
  minDate,
}: {
  value: string;
  onChange: (ymd: string) => void;
  className?: string;
  /** YYYY-MM-DD — dates before this are greyed out and unpickable. */
  minDate?: string;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  const minDateObj = minDate ? new Date(`${minDate}T00:00:00`) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            className={cn(
              "flex items-center gap-2 w-full h-9 rounded-lg border border-[var(--line)] bg-white px-3 text-sm text-left hover:border-[var(--brand-green)] transition-colors",
              className
            )}
          >
            <CalendarDays className="h-4 w-4 text-[var(--ink-soft)] shrink-0" />
            <span className={cn(!date && "text-[var(--ink-soft)]")}>
              {date ? formatLocal(date) : "เลือกวันที่"}
            </span>
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={thDateFns}
          weekStartsOn={0}
          captionLayout="dropdown"
          startMonth={minDateObj ?? PICKER_START}
          endMonth={PICKER_END}
          selected={date}
          defaultMonth={date}
          disabled={minDateObj ? { before: minDateObj } : undefined}
          onSelect={(d) => {
            if (d) {
              onChange(toYMD(d));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
