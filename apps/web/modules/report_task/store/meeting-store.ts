import { create } from "zustand";
import type { CalendarEvent } from "@/modules/report_task/types";

interface MeetingStore {
  meetings: CalendarEvent[];
  addMeeting: (meeting: CalendarEvent) => void;
  /** Patch a meeting — used by both drag-reschedule and the edit form. */
  updateMeeting: (id: string, patch: Partial<CalendarEvent>) => void;
  removeMeeting: (id: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "meetings") in store-hydrator.tsx
// — shared across teammates, not per-browser.
export const useMeetingStore = create<MeetingStore>()((set) => ({
  meetings: [],
  addMeeting: (meeting) => set((s) => ({ meetings: [meeting, ...s.meetings] })),
  updateMeeting: (id, patch) =>
    set((s) => ({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  removeMeeting: (id) => set((s) => ({ meetings: s.meetings.filter((m) => m.id !== id) })),
}));
