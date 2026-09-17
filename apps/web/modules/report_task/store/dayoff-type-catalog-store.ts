import { create } from "zustand";

interface DayoffTypeCatalogStore {
  names: string[];
}

// Server-synced via ServerStoreSync (apiKey "dayoff-type-catalog") in
// store-hydrator.tsx — full list of auto-approve ("สิทธิ์") leave-type names
// from HR (workforce), including ones nobody has an active one of right now.
// Read-only: leave types themselves are configured at /hr/settings, not here
// — this store only feeds the "นับเป็นวันหยุดนักขัตฤกษ์" checklist's options.
export const useDayoffTypeCatalogStore = create<DayoffTypeCatalogStore>()(() => ({
  names: [],
}));
