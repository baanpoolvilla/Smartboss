"use client";

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
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col">
      <div className="rounded-xl border border-[var(--line)] bg-white p-4">
        <PeopleCalendarList singleColumn />
      </div>
    </aside>
  );
}
