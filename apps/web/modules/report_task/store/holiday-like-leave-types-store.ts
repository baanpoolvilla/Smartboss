import { create } from "zustand";

interface HolidayLikeLeaveTypesStore {
  /** Names of auto-approve ("สิทธิ์") leave types the admin picked to read
   *  as "วันหยุดนักขัตฤกษ์" instead of "วันหยุดประจำ" on the calendar — see
   *  workforce-calendar.ts's `holidayLike`. Keyed by name (not id) since
   *  that's the only identifier this module already threads through from
   *  workforce (same as `CalendarEvent.leaveType`). */
  names: string[];
  toggle: (name: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "holiday-like-leave-types") in
// store-hydrator.tsx — company-wide (owner-configured), lives entirely in
// this app's own store (report_task.stores), not the workforce schema.
export const useHolidayLikeLeaveTypesStore = create<HolidayLikeLeaveTypesStore>()((set) => ({
  names: [],
  toggle: (name) =>
    set((s) => ({
      names: s.names.includes(name) ? s.names.filter((n) => n !== name) : [...s.names, name],
    })),
}));
