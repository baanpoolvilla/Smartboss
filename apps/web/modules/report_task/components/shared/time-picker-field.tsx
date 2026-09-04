"use client";

import { useMemo } from "react";
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
 * First version of this component opened a custom hour/minute picker inside
 * a `Popover` using this app's own `Select` (itself popover-based) — nesting
 * one floating-positioned popup inside another broke the inner one's
 * anchoring on mobile Safari (it rendered as a giant unanchored list instead
 * of a small dropdown under its own trigger — "ใช้งานยากอะ"). Two plain
 * native `<select>` elements side by side avoid that entirely: no portal
 * nesting, and a native `<select>` opens the OS's own picker UI, which is
 * exactly the well-tested mobile picking experience this was meant to reach
 * for in the first place — just without `<input type="time">`'s rendering
 * bug specifically.
 *
 * Same value contract as the native input it replaces — `""` means unset —
 * so every call site swaps in with no other changes needed.
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
  const [hour, minute] = useMemo(() => {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    return m ? [m[1]!, m[2]!] : ["", ""];
  }, [value]);

  function commit(nextHour: string, nextMinute: string) {
    if (nextHour && nextMinute) onChange(`${nextHour}:${nextMinute}`);
  }

  return (
    <div
      title={title}
      className={cn(
        "flex min-w-0 items-center gap-1 h-9 rounded-lg border border-[var(--line)] bg-white px-2 text-sm transition-colors focus-within:border-[var(--brand-green)]",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <Clock className="h-3.5 w-3.5 text-[var(--ink-soft)] shrink-0" />
      <select
        aria-label={ariaLabel ? `${ariaLabel} — ชั่วโมง` : "ชั่วโมง"}
        disabled={disabled}
        value={hour}
        onChange={(e) => commit(e.target.value, minute || "00")}
        className={cn("min-w-0 flex-1 bg-transparent outline-none", !hour && "text-[var(--ink-soft)]")}
      >
        <option value="" disabled>
          ชม.
        </option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-[var(--ink-soft)]">:</span>
      <select
        aria-label={ariaLabel ? `${ariaLabel} — นาที` : "นาที"}
        disabled={disabled}
        value={minute}
        onChange={(e) => commit(hour || "00", e.target.value)}
        className={cn("min-w-0 flex-1 bg-transparent outline-none", !minute && "text-[var(--ink-soft)]")}
      >
        <option value="" disabled>
          นาที
        </option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={ariaLabel ? `ล้าง${ariaLabel}` : "ล้างเวลา"}
          className="shrink-0 text-[var(--ink-soft)] hover:text-[var(--ink)] text-xs px-0.5"
        >
          ✕
        </button>
      )}
    </div>
  );
}
