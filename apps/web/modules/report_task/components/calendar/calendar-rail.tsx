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
    // Narrower on a laptop window (lg, 1024-1279px) and the space right above
    // it (xl, 1280-1535px) than on a full-width monitor (2xl, 1536px+) — full
    // 256px here was a fixed tax on every window in that whole range, on top
    // of the app shell's own left nav, that left the calendar grid's 7
    // columns squeezed enough for names to truncate hard ("Kanitha-Aui...").
    // Names/avatars in PeopleCalendarList already wrap/truncate gracefully at
    // any of these widths, so shrinking this doesn't lose information, just
    // gives the calendar grid the room back.
    <aside className="hidden lg:flex lg:w-52 xl:w-56 2xl:w-64 shrink-0 flex-col">
      {/* Explicit height (not just a max-height cap) keeps this box the same
          height as the calendar next to it regardless of how many people
          are showing, and alwaysExpanded skips PeopleCalendarList's own
          8-person collapse — together the box fills its full height with
          real names instead of stopping at 8 and leaving the rest of a
          tall box empty ("แสดงให้เต็มก่อนสิ"). overflow-y still scrolls
          internally on the rare org too big to fit at all. */}
      <div
        ref={boxRef}
        className="rounded-xl border border-[var(--line)] bg-white p-4 overflow-y-auto"
        style={{ height: boxHeight }}
      >
        <PeopleCalendarList singleColumn alwaysExpanded />
      </div>
    </aside>
  );
}
