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
    }),
    { name: "eb-calendar-visibility", skipHydration: true }
  )
);
