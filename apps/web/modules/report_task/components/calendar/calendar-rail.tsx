"use client";

import { useEffect, useRef, useState } from "react";
import { PeopleCalendarList } from "./people-calendar-list";

/**
 * Outlook/Teams-style left rail — always visible on desktop (≥lg), unlike
 * the "คนในองค์กร" list which used to live behind the "เพิ่มปฏิทิน" dialog.
 * No mini date-picker here (dropped per feedback — a second, smaller
 * calendar next to the real one just added redundant complexity). Mobile
 * stays a single icon button opening the same list in a sheet (see
 * calendar-view.tsx) instead of a permanent rail — there isn't room for one.
 */
export function CalendarRail() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // A fixed "100vh - 140px" guess didn't match this page's actual header
  // height (top bar + filter row + legend, which varies by tab/org) — on a
  // big org list it ran past the real viewport bottom, cutting off mid-row
  // instead of stopping cleanly, which read as "there's more below" even
  // though it was just clipped by the browser edge. Measuring this box's
  // own top, same approach FullCalendarView already uses for its height, so
  // the cap always matches how much room is actually left on screen.
  const [boxHeight, setBoxHeight] = useState<number>();
  useEffect(() => {
    function computeBoxHeight() {
      const top = boxRef.current?.getBoundingClientRect().top ?? 0;
      // 16px landed the box's own bottom edge flush against the viewport
      // edge — technically not overflowing anymore, but with zero breathing
      // room it still read as cramped/uncomfortable ("ให้เหลือเว้นไว้สักนิด").
      // A bit more slack below settles it clearly inside the fold.
      setBoxHeight(Math.max(240, Math.round(window.innerHeight - top - 32)));
    }
    computeBoxHeight();
    window.addEventListener("resize", computeBoxHeight);
    return () => window.removeEventListener("resize", computeBoxHeight);
  }, []);

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col">
      {/* A collapsed people list (most orgs) is way shorter than the
          calendar next to it — capping with max-height alone let this box
          shrink-wrap to that short content, so the two side-by-side cards
          ended at very different heights and read as unbalanced. Setting an
          explicit height (not just a cap) instead keeps this box the same
          height as the calendar regardless of how many people are showing;
          overflow-y still scrolls internally on the rare org big enough to
          actually exceed it. */}
      <div
        ref={boxRef}
        className="rounded-xl border border-[var(--line)] bg-white p-4 overflow-y-auto"
        style={{ height: boxHeight }}
      >
        <PeopleCalendarList singleColumn />
      </div>
    </aside>
  );
}
