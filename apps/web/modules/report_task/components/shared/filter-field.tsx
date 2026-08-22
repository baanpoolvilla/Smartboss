import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
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

/** One full-width row inside a mobile filter sheet — icon box + label +
 * value, in place of the desktop bar's label-above-pill pattern (which
 * reads fine as narrow pills in a row, but stacks awkwardly once every
 * field has to go full-width instead). Pass as a SelectTrigger's className,
 * same "!"-prefixed override as filterFieldTriggerClass — the trigger's own
 * `data-[size=default]:h-8` outranks a plain h-* class on specificity alone. */
export function mobileFieldRowTriggerClass(active: boolean) {
  return cn(
    "flex !h-[52px] w-full items-center gap-3 rounded-2xl border-none px-3.5 text-left shadow-none outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-[var(--accent-foreground)]/30 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-soft)]",
    active
      ? "bg-[color-mix(in_srgb,var(--brand-green)_20%,white)]"
      : "bg-[var(--bg-soft)] hover:bg-[var(--line)]/70"
  );
}

/** The small icon square on the left of a mobile filter row — tints green
 * once that row has a non-default value picked, same "active" language as
 * the desktop pill's own tint. */
export function MobileFieldIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white",
        active ? "border-[var(--brand-green-dark)]/35 text-[var(--brand-green-dark)]" : "border-[var(--line)] text-[var(--ink-soft)]"
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** The value text on the right of a mobile filter row, before the
 * trigger's own chevron. */
export function MobileFieldValue({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "ml-auto max-w-[130px] truncate text-sm",
        active ? "font-semibold text-[var(--brand-green-dark)]" : "text-[var(--ink-soft)]"
      )}
    >
      {children}
    </span>
  );
}

/** One quick-filter chip — a single tap that sets/clears one real filter
 * field directly (no sheet-within-sheet), for the handful of filters used
 * often enough to deserve a one-tap shortcut ahead of the full field list. */
export function QuickFilterChip({
  active,
  warn,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  warn?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition-colors",
        !active && "border-[var(--line)] bg-white text-[var(--ink)] [&_svg]:text-[var(--ink-soft)] hover:bg-[var(--bg-soft)]",
        active &&
          !warn &&
          "border-[var(--brand-green-dark)]/30 bg-[color-mix(in_srgb,var(--brand-green)_18%,white)] text-[var(--brand-green-dark)] [&_svg]:text-[var(--brand-green-dark)]",
        active && warn && "border-red-200 bg-red-50 text-[var(--chart-red)] [&_svg]:text-[var(--chart-red)]"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
