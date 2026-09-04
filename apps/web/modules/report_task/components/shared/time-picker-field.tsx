"use client";

import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { Clock } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, m) => String(m).padStart(2, "0"));

/**
 * "HH:mm" time field — replaces `<input type="time">` (issue B). The native
 * control's own picker UI can't be restyled and renders as a blank white box
 * with no visible placeholder on iOS Safari when empty (see
 * new-task-dialog.tsx's `showDueTime` comment, which worked around exactly
 * this by hiding the field instead of fixing it). Same value contract as the
 * native input it replaces — `""` means unset — so every call site swaps in
 * with no other changes needed. Modeled on `DatePickerField`, this module's
 * existing replacement for `<input type="date">`.
 */
export function TimePickerField({
  value,
  onChange,
  className,
  disabled,
  placeholder = "เวลา",
  "aria-label": ariaLabel,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hour, minute] = useMemo(() => {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    return m ? [m[1]!, m[2]!] : [null, null];
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            title={title}
            className={cn(
              "flex min-w-0 items-center gap-2 h-9 rounded-lg border border-[var(--line)] bg-white px-3 text-sm text-left hover:border-[var(--brand-green)] transition-colors disabled:pointer-events-none disabled:opacity-50",
              className
            )}
          >
            <Clock className="h-3.5 w-3.5 text-[var(--ink-soft)] shrink-0" />
            <span className={cn("truncate", !value && "text-[var(--ink-soft)]")}>{value || placeholder}</span>
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex items-center gap-1.5">
          <Select value={hour ?? undefined} onValueChange={(h) => h && onChange(`${h}:${minute ?? "00"}`)}>
            <SelectTrigger size="sm" className="w-[68px]">
              <SelectValue placeholder="ชม." />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-[var(--ink-soft)]">:</span>
          <Select value={minute ?? undefined} onValueChange={(m) => m && onChange(`${hour ?? "00"}:${m}`)}>
            <SelectTrigger size="sm" className="w-[68px]">
              <SelectValue placeholder="นาที" />
            </SelectTrigger>
            <SelectContent>
              {MINUTES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value && (
            <button
              type="button"
              className="ml-1 shrink-0 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              ล้าง
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
