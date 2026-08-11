import { create } from "zustand";
import { thaiHolidayEvents } from "@/modules/report_task/data/thai-holidays";
import type { CalendarEvent } from "@/modules/report_task/types";

/** Nager.Date has no Thai data, so Thailand's holidays are seeded locally
 * (id `hol-...`) instead of imported (id `holiday-{code}-...`) — but they're
 * still just "one more country" in the same personal-selection system. */
export const THAI_SOURCE = "TH";

export function holidaySource(h: CalendarEvent): string {
  return h.id.startsWith("holiday-") ? (h.id.split("-")[1] ?? THAI_SOURCE) : THAI_SOURCE;
}

/** Whether `userId` has this country's holidays showing on their own
 * calendar — Thailand defaults on for anyone who hasn't touched their
 * selection yet (so it doesn't vanish the first time someone opens this
 * dialog), every other country defaults off. */
export function isSourceSelected(
  selectedByUser: Record<string, string[]>,
  userId: string,
  source: string
): boolean {
  const mine = selectedByUser[userId];
  if (mine === undefined) return source === THAI_SOURCE;
  return mine.includes(source);
}

interface HolidayStore {
  /** The actual imported holiday events — a shared cache of holiday facts (fetched once, reused by anyone who selects that country). Personal to nobody by itself. */
  holidays: CalendarEvent[];
  /** Which country-source tags each user has personally chosen to see on their own calendar — importing a country doesn't push it onto everyone else's. */
  selectedByUser: Record<string, string[]>;
  addHoliday: (h: CalendarEvent) => void;
  /** Bulk import (e.g. from a public-holiday API) — skips ids already present. */
  addManyHolidays: (items: CalendarEvent[]) => number;
  updateHoliday: (id: string, patch: Partial<CalendarEvent>) => void;
  removeHoliday: (id: string) => void;
  /** Remove every holiday imported from a given source tag (see `addManyHolidays` callers). */
  removeBySource: (source: string) => void;
  /** Add a country source to just this user's own personal selection. */
  selectSource: (userId: string, source: string) => void;
  /** Remove a country source from just this user's own personal selection (the underlying holiday data stays, in case someone else still has it selected). */
  deselectSource: (userId: string, source: string) => void;
}

/** Fetches a country's public holidays for one year into the shared holiday
 * cache (used e.g. by a "country"-sourced leave-type grant) — independent of
 * anyone's personal per-user country selection. Thailand is already seeded
 * locally, so this is a no-op for it. Returns the number of newly-added
 * holiday events (0 on failure or if already cached). */
export async function importCountryHolidays(countryCode: string, year: number): Promise<number> {
  if (countryCode === THAI_SOURCE) return 0;
  try {
    const res = await fetch(`/api/report-task/holidays?country=${countryCode}&year=${year}`);
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) return 0;
    const items: CalendarEvent[] = data.map((h: { date: string; localName: string; name: string }) => ({
      id: `holiday-${countryCode}-${h.date}`,
      title: `${h.localName}${h.name !== h.localName ? ` (${h.name})` : ""}`,
      type: "holiday",
      start: h.date,
      end: h.date,
      allDay: true,
      description: `นำเข้าจากวันหยุดราชการ ${countryCode} ปี ${year}`,
    }));
    return useHolidayStore.getState().addManyHolidays(items);
  } catch {
    return 0;
  }
}

// Server-synced via ServerStoreSync (apiKey "holidays") in
// store-hydrator.tsx — shared across teammates, not per-browser.
export const useHolidayStore = create<HolidayStore>()(
  (set, get) => ({
      holidays: thaiHolidayEvents,
      selectedByUser: {},
      addHoliday: (h) => set((s) => ({ holidays: [h, ...s.holidays] })),
      addManyHolidays: (items) => {
        const existingIds = new Set(get().holidays.map((h) => h.id));
        const fresh = items.filter((h) => !existingIds.has(h.id));
        if (fresh.length > 0) set((s) => ({ holidays: [...fresh, ...s.holidays] }));
        return fresh.length;
      },
      updateHoliday: (id, patch) =>
        set((s) => ({ holidays: s.holidays.map((h) => (h.id === id ? { ...h, ...patch } : h)) })),
      removeHoliday: (id) => set((s) => ({ holidays: s.holidays.filter((h) => h.id !== id) })),
      removeBySource: (source) =>
        set((s) => ({ holidays: s.holidays.filter((h) => !h.id.startsWith(`holiday-${source}-`)) })),
      selectSource: (userId, source) =>
        set((s) => {
          const current = s.selectedByUser[userId] ?? [];
          if (current.includes(source)) return s;
          return { selectedByUser: { ...s.selectedByUser, [userId]: [...current, source] } };
        }),
      deselectSource: (userId, source) =>
        set((s) => ({
          selectedByUser: { ...s.selectedByUser, [userId]: (s.selectedByUser[userId] ?? []).filter((c) => c !== source) },
        })),
  })
);
