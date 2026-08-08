import { create } from "zustand";

/**
 * Section keys from settings/page.tsx's `sectionsByTab.company` that the
 * owner can delegate to a specific employee — section-level granularity, not
 * per-button. Deliberately excludes "accessControl" itself (only the owner
 * grants access, never a delegate) and every non-company tab (report rooms
 * already have their own department-head scoping; profile is always
 * personal).
 */
export type GrantableSection = "stickers" | "leaveTypes" | "routineDayoff" | "reportTopics";

interface SettingsAccessStore {
  /** userId -> set of company-tab section keys that user has been granted, on top of their normal role. */
  grants: Record<string, GrantableSection[]>;
  setGrant: (userId: string, sections: GrantableSection[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "settings-access") in
// store-hydrator.tsx — shared org-wide config, not per-browser.
export const useSettingsAccessStore = create<SettingsAccessStore>()((set) => ({
  grants: {},
  setGrant: (userId, sections) =>
    set((s) => ({
      grants: sections.length
        ? { ...s.grants, [userId]: sections }
        : Object.fromEntries(Object.entries(s.grants).filter(([id]) => id !== userId)),
    })),
}));
