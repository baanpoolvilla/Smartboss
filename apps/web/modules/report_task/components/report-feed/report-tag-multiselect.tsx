"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ReportTag } from "@/modules/report_task/store/report-tag-store";
import { Check, Search } from "lucide-react";

/** Past this many curated tags, a bare scrolling checklist stops being
 * scannable — the search box earns its screen space here, not before. */
const SEARCH_THRESHOLD = 8;

/**
 * The inner list for any "pick one or more tags" popover — shared by
 * TagPickerButton (post composer: "which tags does this post carry") and
 * PostFilterBar (feed: "which tags should narrow the feed"), so both read
 * as the same interaction instead of two similar-but-subtly-different
 * pickers. Handles the thing that breaks a flat checklist once a company
 * has accumulated a lot of tags: a search box that only appears once
 * there's enough tags to need it, and already-picked tags pinned in their
 * own section above the rest so "what's currently selected" never requires
 * scrolling to confirm.
 */
export function TagMultiSelectList({
  tags,
  selectedIds,
  onToggle,
  emptyLabel = "ยังไม่มีแท็ก",
  noMatchPrefix = "ไม่พบแท็กที่ตรงกับ",
  footer,
}: {
  tags: ReportTag[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** Shown instead of the list when the company has no tags at all yet. */
  emptyLabel?: string;
  noMatchPrefix?: string;
  /** e.g. TagPickerButton's "สร้างแท็กใหม่..." — the filter dropdown has none. */
  footer?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  // Re-seeding on every render when the caller's popover closes/reopens is
  // handled by the caller unmounting this (Popover content), not by an
  // effect here — nothing to reset on mount beyond the initial "" above.
  const selected = tags.filter((t) => selectedIds.includes(t.id));
  const q = query.trim().toLowerCase();
  // Selected tags stay pinned in their own section regardless of the search
  // box — typing to find one more tag should never make an already-picked
  // one seem to have silently come off.
  const rest = tags.filter((t) => !selectedIds.includes(t.id) && (!q || t.name.toLowerCase().includes(q)));

  if (tags.length === 0) {
    return (
      <>
        <p className="px-1.5 py-2 text-xs text-[var(--ink-soft)]">{emptyLabel}</p>
        {footer}
      </>
    );
  }

  return (
    <>
      {tags.length > SEARCH_THRESHOLD && (
        <div className="relative px-0.5 pb-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ink-faint)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาแท็ก..."
            className="w-full rounded-md border border-[var(--line)] bg-transparent py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:border-[var(--brand-green)]/50"
          />
        </div>
      )}
      <div className="max-h-56 overflow-y-auto">
        {selected.length > 0 && (
          <div className="space-y-0.5 pb-1 mb-1 border-b border-[var(--line)]">
            {selected.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onToggle(t.id)}
                className="w-full flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-left bg-[var(--accent)] hover:bg-[var(--accent)]"
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} aria-hidden />
                <span className="truncate flex-1">{t.name}</span>
                <Check className="h-3 w-3 shrink-0 text-[var(--brand-green-dark)]" />
              </button>
            ))}
          </div>
        )}
        {rest.length > 0 ? (
          <div className="space-y-0.5">
            {rest.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onToggle(t.id)}
                className="w-full flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs text-left hover:bg-[var(--bg-soft)]"
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} aria-hidden />
                <span className="truncate flex-1">{t.name}</span>
              </button>
            ))}
          </div>
        ) : (
          q && (
            <p className="px-1.5 py-2 text-xs text-[var(--ink-soft)]">
              {noMatchPrefix} &quot;{query}&quot;
            </p>
          )
        )}
      </div>
      {footer}
    </>
  );
}
