import type { ReactNode } from "react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * One shared "boxed filter field" look — a faint label above a bordered
 * pill (icon + value + chevron), active-filtered state tinted with the
 * app's accent — reused by every filter bar in the app (Dashboard, Task
 * Board, ...) so they all read as the same control instead of each page
 * inventing its own field chrome.
 */
export const FILTER_FIELD_LABEL_CLASS = "text-[10px] leading-none text-[var(--ink-soft)] px-0.5";

export function filterFieldTriggerClass(active: boolean, widthClass = "") {
  return cn(
    "flex items-center gap-1.5 rounded-lg border-[0.5px] py-[7px] px-[11px] text-sm font-medium transition-colors",
    widthClass,
    active
      ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent-foreground)]/25 [&_svg]:text-[var(--accent-foreground)]"
      : "bg-white border-[var(--line)] text-[var(--ink)] hover:bg-[var(--bg-soft)] hover:border-[var(--border-strong)] [&_svg]:text-[var(--ink-soft)]"
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
