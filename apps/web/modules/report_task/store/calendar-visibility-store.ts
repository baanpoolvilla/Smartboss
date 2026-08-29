import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Outlook-style "People's calendars" — which team members' tasks/meetings/
 * leave show on the calendar right now. Off by default = nobody hidden.
 */
interface CalendarVisibilityStore {
  hiddenUserIds: string[];
  toggle: (userId: string) => void;
  showAll: () => void;
  hideAll: (allUserIds: string[]) => void;
  /** Same idea as hiddenUserIds, keyed by holiday source (see holiday-store's
   * holidaySource) instead of user id — a purely local show/hide preference.
   * Holidays themselves come from the HR module now (org-wide, read-only —
   * see the "holidays" WORKFORCE_KEYS guard in the store API route, which
   * rejects any write with 409), so this can't round-trip through
   * holiday-store's old per-user selectSource/deselectSource like it used
   * to before that migration — every such write is now permanently
   * rejected. This stays local-only, same as hiddenUserIds. */
  hiddenHolidaySourceIds: string[];
  toggleHolidaySource: (source: string) => void;
}

export const useCalendarVisibilityStore = create<CalendarVisibilityStore>()(
  persist(
    (set) => ({
      hiddenUserIds: [],
      toggle: (userId) =>
        set((s) => ({
          hiddenUserIds: s.hiddenUserIds.includes(userId)
            ? s.hiddenUserIds.filter((id) => id !== userId)
            : [...s.hiddenUserIds, userId],
        })),
      showAll: () => set({ hiddenUserIds: [] }),
      hideAll: (allUserIds) => set({ hiddenUserIds: allUserIds }),
      hiddenHolidaySourceIds: [],
      toggleHolidaySource: (source) =>
        set((s) => ({
          hiddenHolidaySourceIds: s.hiddenHolidaySourceIds.includes(source)
            ? s.hiddenHolidaySourceIds.filter((id) => id !== source)
            : [...s.hiddenHolidaySourceIds, source],
        })),
    }),
    { name: "eb-calendar-visibility", skipHydration: true }
  )
);
