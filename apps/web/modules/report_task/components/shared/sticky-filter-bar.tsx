import type { ReactNode } from "react";

/**
 * §7.1 — the page title + filter bar + any active-filter chips stick under
 * the Topbar together as the page scrolls, instead of the title scrolling
 * away and leaving a floating filter bar with no context. `sticky top-0`
 * against `<main>` (the app's one scroll container) — `main` carries no top
 * padding, so `top-0` sticks this bar flush against Topbar with no negative
 * offset needed. Never `position: fixed`, which would fall out of `main`'s
 * own layout flow.
 *
 * `-mx-4 sm:-mx-6` + matching `px-4 sm:px-6` makes this full-bleed and must
 * stay in lockstep with AppScaffold's content padding (`px-4 sm:px-6`) at
 * every breakpoint — if the two ever drift apart the bar's edge no longer
 * lines up with the page frame (that mismatch is exactly what we just fixed).
 * The padded content wrapper carries that padding, so without canceling it
 * here the bar would
 * be inset like every other card and content scrolling up on either side
 * would show through past its edges instead of being covered. The opaque
 * `bg-[var(--bg-soft)]`, permanent `border-b`, and drop shadow below are
 * what make scrolled-under content read as "a separate layer sliding
 * beneath a bar," not "overlapping the bar with no boundary."
 *
 * The filter controls (`children`) sit in their own bordered card instead of
 * floating loose on the bar's background — one consistent "filters live in
 * this box" frame across every page. Whether a filter is active is shown by
 * the field itself tinting green (`filterFieldTriggerClass`), so there's no
 * separate "กำลังดู: ..." chip row to keep in sync with the field state.
 */
export function StickyFilterBar({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // -mt-4 sm:-mt-5 cancels AppScaffold's own top padding (py-4 sm:py-5),
    // same full-bleed trick as -mx-4/-mx-6 already does horizontally —
    // without it this bar sits a visible 16-20px below the app header
    // instead of flush against it (screenshot: an empty gap above the tabs).
    <div className="sticky top-0 z-30 -mx-4 px-4 -mt-4 sm:-mx-6 sm:px-6 sm:-mt-5 bg-[var(--bg-soft)]/95 backdrop-blur-sm border-b border-[var(--line)] shadow-[0_4px_12px_-6px_rgba(0,0,0,0.15)] py-3 flex flex-col gap-3">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {title && (
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)] leading-tight">{title}</h1>
              {subtitle && <p className="text-sm text-[var(--ink-soft)] mt-1">{subtitle}</p>}
            </div>
          )}
          {actions}
        </div>
      )}
      {children && (
        <div className="rounded-xl border border-[var(--line)] bg-white p-2.5 sm:p-3 max-w-full overflow-x-auto">
          {children}
        </div>
      )}
    </div>
  );
}
