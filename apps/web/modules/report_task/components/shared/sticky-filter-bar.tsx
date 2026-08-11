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
 * `-mx-4 lg:-mx-6` + matching `px-4 lg:px-6` makes this full-bleed: `main`
 * itself carries that padding, so without canceling it here the bar would
 * be inset like every other card and content scrolling up on either side
 * would show through past its edges instead of being covered. The opaque
 * `bg-[var(--bg-soft)]`, permanent `border-b`, and drop shadow below are
 * what make scrolled-under content read as "a separate layer sliding
 * beneath a bar," not "overlapping the bar with no boundary."
 */
export function StickyFilterBar({
  title,
  subtitle,
  actions,
  children,
  activeChips,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  activeChips?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 px-4 lg:px-6 bg-[var(--bg-soft)] border-b border-[var(--line)] shadow-[0_4px_12px_-6px_rgba(0,0,0,0.15)] py-3 flex flex-col gap-3">
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
      {children && <div className="max-w-full overflow-x-auto">{children}</div>}
      {activeChips}
    </div>
  );
}
