import { create } from "zustand";

interface LeaveTypeCatalogStore {
  names: string[];
}

// Server-synced via ServerStoreSync (apiKey "leave-type-catalog") in
// store-hydrator.tsx — full list of leave-type names from HR (workforce),
// including ones nobody has an active leave of right now. Read-only: leave
// types are configured at /hr/settings, not here.
export const useLeaveTypeCatalogStore = create<LeaveTypeCatalogStore>()(() => ({
  names: [],
}));
