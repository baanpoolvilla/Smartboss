"use client";

import { Check } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Single-select group of tap chips — the mobile filter sheet's replacement
 * for a native `<select>` (a native select pops a full-screen OS picker on a
 * phone, which reads as jarring/ugly next to everything else in the sheet).
 * Not used on desktop — the boxed dropdown (`FilterField`/`Select`) stays
 * there since it's already compact and mouse-friendly.
 */
export function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-[11px] font-medium text-[var(--ink-soft)] px-0.5">{label}</span>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-11 items-center gap-1 rounded-full border px-3.5 text-sm font-medium transition-colors",
                active
                  ? "bg-[var(--brand-green)] border-[var(--brand-green)] text-white"
                  : "bg-white border-[var(--line)] text-[var(--ink)] hover:bg-[var(--bg-soft)]"
              )}
            >
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
