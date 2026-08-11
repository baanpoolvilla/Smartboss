"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

/** The expand/collapse control under a capped list — a real pill button
 * (not just a text row) so it reads as clickable at a glance, same idea as
 * MS Teams Planner's "Completed tasks N ⌄" but with an actual button shell
 * and a working way back (click again to collapse). Renders nothing once
 * there's nothing left to expand and the list is already collapsed. */
export function ShowMoreToggle({ expanded, remaining, onToggle }: { expanded: boolean; remaining: number; onToggle: () => void }) {
  if (!expanded && remaining <= 0) return null;
  return (
    <div className="mt-2 flex justify-center">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] shadow-sm hover:bg-[var(--bg-soft)] hover:border-[var(--border-strong)] transition-colors"
      >
        {expanded ? "แสดงน้อยลง" : `แสดงเพิ่มเติม ${remaining} รายการ`}
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
