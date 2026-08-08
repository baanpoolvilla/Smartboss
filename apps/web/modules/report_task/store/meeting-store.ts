import { create } from "zustand";
import { calendarEvents } from "@/modules/report_task/data/mock";
import type { CalendarEvent } from "@/modules/report_task/types";

const initialMeetings = calendarEvents.filter((e) => e.type === "meeting");

interface MeetingStore {
  meetings: CalendarEvent[];
  addMeeting: (meeting: CalendarEvent) => void;
  /** Patch a meeting — used by both drag-reschedule and the edit form. */
  updateMeeting: (id: string, patch: Partial<CalendarEvent>) => void;
  removeMeeting: (id: string) => void;
  /** Deletes every meeting created together in one "ทำซ้ำ" (repeat) batch. */
  removeMeetingSeries: (seriesId: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "meetings") in store-hydrator.tsx
// — shared across teammates, not per-browser.
export const useMeetingStore = create<MeetingStore>()((set) => ({
  meetings: initialMeetings,
  addMeeting: (meeting) => set((s) => ({ meetings: [meeting, ...s.meetings] })),
  updateMeeting: (id, patch) =>
    set((s) => ({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  removeMeeting: (id) => set((s) => ({ meetings: s.meetings.filter((m) => m.id !== id) })),
  removeMeetingSeries: (seriesId) =>
    set((s) => ({ meetings: s.meetings.filter((m) => m.seriesId !== seriesId) })),
}));
