import type { ReactNode } from "react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * One shared "boxed filter field" look — a faint label above a bordered
 * pill (icon + value + chevron), active-filtered state tinted with the
 * app's accent — reused by every filter bar in the app (Dashboard, Task
 * Board, ...) so they all read as the same control instead of each page
 * inventing its own field chrome.
 */
export const FILTER_FIELD_LABEL_CLASS = "text-[11px] font-medium leading-none tracking-wide text-[var(--ink-soft)] px-0.5";

export function filterFieldTriggerClass(active: boolean, widthClass = "") {
  return cn(
    // One fixed 36px height + full 1px border so every field lines up on a
    // single baseline and reads crisp at any zoom (0.5px borders shimmer).
    // Softer radius, a hairline shadow for lift, and a focus-visible ring
    // for keyboard users — the same pill on every filter bar in the app.
    // !h-9 beats SelectTrigger's own data-[size=default]:h-8 so Select pills
    // and plain-span pills (Task Board) land on the exact same 36px height.
    "flex !h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium shadow-sm outline-none transition-[background-color,border-color,box-shadow,color] duration-150",
    "focus-visible:ring-2 focus-visible:ring-[var(--accent-foreground)]/30 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-soft)]",
    widthClass,
    active
      ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent-foreground)]/25 [&_svg]:text-[var(--accent-foreground)]"
      : "bg-[var(--bg)] border-[var(--line)] text-[var(--ink)] hover:bg-[var(--bg-soft)] hover:border-[var(--border-strong)] [&_svg]:text-[var(--ink-soft)]"
  );
}

/** Label + field wrapper — pass the Select/box as `children`. `labelExtra`
 * renders right after the label (e.g. an info icon for a field whose
 * options need a one-line explanation). */
export function FilterField({ label, labelExtra, children }: { label: string; labelExtra?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={cn(FILTER_FIELD_LABEL_CLASS, "flex items-center gap-1")}>
        {label}
        {labelExtra}
      </span>
      {children}
    </div>
  );
}
