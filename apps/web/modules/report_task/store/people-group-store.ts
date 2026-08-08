import { create } from "zustand";

/** A named, reusable set of people — e.g. "ทีมการตลาด" — for quick-picking in attendee pickers. */
export interface PeopleGroup {
  id: string;
  name: string;
  userIds: string[];
}

interface PeopleGroupStore {
  groups: PeopleGroup[];
  addGroup: (name: string, userIds: string[]) => void;
  removeGroup: (id: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "people-groups") in
// store-hydrator.tsx — shared across teammates, not per-browser.
export const usePeopleGroupStore = create<PeopleGroupStore>()((set) => ({
  groups: [],
  addGroup: (name, userIds) =>
    set((s) => ({ groups: [...s.groups, { id: `grp-${crypto.randomUUID()}`, name, userIds }] })),
  removeGroup: (id) => set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),
}));
