"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Clock } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, m) => String(m).padStart(2, "0"));

/**
 * "HH:mm" time field — replaces `<input type="time">` (issue B). The native
 * control's own picker UI can't be restyled and renders as a blank white box
 * with no visible placeholder on iOS Safari when empty (see
 * new-task-dialog.tsx's `showDueTime` comment, which worked around exactly
 * this by hiding the field instead of fixing it).
 *
 * Two earlier versions of this component, both replaced:
 * 1. Nested a `Select` (itself popover-based) inside this component's own
 *    `Popover` — two floating-positioned popups nested broke the inner
 *    one's anchoring on mobile Safari ("ใช้งานยากอะ").
 * 2. Two native `<select>` elements avoided the nesting bug, but rendered as
 *    the browser's own unstyled dropdown list on desktop — plain, long, and
 *    visibly inconsistent with the rest of the app ("ไม่เอาแบบนี้... ดูสบายตา").
 *
 * This version keeps the single-`Popover` win from #2 (no nested floating
 * UI, so positioning stays correct on mobile) but builds the hour/minute
 * picker itself out of plain scrollable button columns instead of a native
 * `<select>` or another `Select` — fully styled, and the same popover
 * handles both, so there's still only ever one floating layer.
 */
export function TimePickerField({
  value,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hour, minute] = useMemo(() => {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    return m ? [m[1]!, m[2]!] : [null, null];
  }, [value]);

  function commit(nextHour: string, nextMinute: string) {
    onChange(`${nextHour}:${nextMinute}`);
  }

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
            <span className={cn("truncate", !value && "text-[var(--ink-soft)]")}>{value || "เวลา"}</span>
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex items-start gap-1">
          <TimeColumn options={HOURS} value={hour} onSelect={(h) => commit(h, minute ?? "00")} open={open} />
          <div className="flex h-9 items-center text-sm text-[var(--ink-soft)]">:</div>
          <TimeColumn options={MINUTES} value={minute} onSelect={(m) => commit(hour ?? "00", m)} open={open} />
        </div>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="mt-1.5 w-full rounded-md py-1 text-center text-xs text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
          >
            ล้างเวลา
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TimeColumn({
  options,
  value,
  onSelect,
  open,
}: {
  options: string[];
  value: string | null;
  onSelect: (v: string) => void;
  open: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Jump straight to the current selection when the popover opens, instead
  // of always starting scrolled to 00 — picking "23" shouldn't mean scrolling
  // past 22 other rows every time you reopen it.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[data-selected="true"]');
    selected?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <div ref={listRef} className="h-48 w-14 overflow-y-auto rounded-md">
      {options.map((opt) => {
        const selected = opt === value;
        return (
          <button
            key={opt}
            type="button"
            data-selected={selected}
            onClick={() => onSelect(opt)}
            className={cn(
              "block w-full rounded-md px-2 py-1.5 text-center text-sm tabular-nums transition-colors",
              selected ? "bg-[var(--accent)] font-medium text-[var(--brand-green-dark)]" : "text-[var(--ink)] hover:bg-[var(--bg-soft)]"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
