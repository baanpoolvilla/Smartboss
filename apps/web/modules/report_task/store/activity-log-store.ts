import { create } from "zustand";
import type { ActivityItem } from "@/modules/report_task/types";

/** Keep the log bounded — this is a running audit trail, not a database. */
const MAX_ENTRIES = 1000;

interface ActivityLogStore {
  entries: ActivityItem[];
  log: (entry: Omit<ActivityItem, "id" | "createdAt">) => void;
}

// Server-synced via ServerStoreSync (apiKey "activity-log") in
// store-hydrator.tsx — shared across teammates, not per-browser.
export const useActivityLogStore = create<ActivityLogStore>()((set) => ({
  entries: [],
  log: (entry) =>
    set((s) => ({
      entries: [
        { ...entry, id: `log-${crypto.randomUUID()}`, createdAt: new Date().toISOString() },
        ...s.entries,
      ].slice(0, MAX_ENTRIES),
    })),
}));
