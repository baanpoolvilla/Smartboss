import { create } from "zustand";
import type { CalendarEvent } from "@/modules/report_task/types";

interface LeaveStore {
  leaves: CalendarEvent[];
  addLeave: (leave: CalendarEvent) => void;
  /** Patch a leave — used by both drag-reschedule and the edit form. */
  updateLeave: (id: string, patch: Partial<CalendarEvent>) => void;
  removeLeave: (id: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "leaves") in store-hydrator.tsx —
// shared across teammates, not per-browser.
export const useLeaveStore = create<LeaveStore>()((set) => ({
  leaves: [],
  addLeave: (leave) => set((s) => ({ leaves: [leave, ...s.leaves] })),
  updateLeave: (id, patch) =>
    set((s) => ({ leaves: s.leaves.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
  removeLeave: (id) => set((s) => ({ leaves: s.leaves.filter((l) => l.id !== id) })),
}));
