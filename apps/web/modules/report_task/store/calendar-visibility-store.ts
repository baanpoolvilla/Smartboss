import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeLocalStorage } from "@/modules/report_task/lib/safe-storage";

/**
 * Outlook-style "People's calendars" — which team members' tasks/meetings/
 * leave show on the calendar right now. Off by default = nobody hidden.
 */
interface CalendarVisibilityStore {
  hiddenUserIds: string[];
  toggle: (userId: string) => void;
  showAll: () => void;
  hideAll: (allUserIds: string[]) => void;
  /** Show/hide a connected external (Google) calendar — kept separate from
   * hiddenUserIds on purpose. That one flag used to double as "hide this
   * person's connected calendar too", which meant turning off your OWN
   * imported calendar (the "ปฏิทินภายนอก" chip) also hid your own
   * tasks/meetings from your own view, and hiding a colleague's regular
   * items from the "คนในองค์กร" list also dropped their imported calendar
   * — two different things a viewer clearly wants to control independently
   * ("กดปิดแล้วมันปิดหมดเลย ... แยกอิมพอตปิดได้"). */
  hiddenGoogleOwnerIds: string[];
  toggleGoogleOwner: (ownerId: string) => void;
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
      hiddenGoogleOwnerIds: [],
      toggleGoogleOwner: (ownerId) =>
        set((s) => ({
          hiddenGoogleOwnerIds: s.hiddenGoogleOwnerIds.includes(ownerId)
            ? s.hiddenGoogleOwnerIds.filter((id) => id !== ownerId)
            : [...s.hiddenGoogleOwnerIds, ownerId],
        })),
    }),
    { name: "eb-calendar-visibility", skipHydration: true, storage: createJSONStorage(() => safeLocalStorage) }
  )
);
