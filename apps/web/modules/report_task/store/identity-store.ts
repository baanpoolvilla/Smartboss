import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";

interface IdentityStore {
  viewingAsUserId: string;
  setViewingAs: (userId: string) => void;
}

// Defaults to a regular (non-owner) employee, falling back to whoever's
// first — NOT the owner. Every load used to default to the CEO account
// (isOwner: true), which meant anyone opening the app started with
// full-visibility/full-access permissions everywhere (every issue-report
// ticket, every internal note, every settings page) until they manually
// switched identity. That's backwards for a demo whose whole point is
// simulating different roles' restricted views — see
// ISSUE_DESK_AUDIT_2026-08-08.md §B2.
function defaultViewingAsUserId(): string {
  const employees = useEmployeeStore.getState().employees;
  return employees.find((u) => !u.isOwner)?.id ?? employees[0]?.id ?? "";
}

// Persisted (unlike most other zustand stores in this app, which are
// server-synced) — this is a per-browser dev/demo convenience, the
// stand-in for real auth per-session identity, not shared team state.
// `skipHydration` + the explicit `rehydrate()` call in store-hydrator.tsx
// matches every other localStorage-backed store here, so the persisted
// value is applied after mount instead of during SSR (where localStorage
// doesn't exist).
export const useIdentityStore = create<IdentityStore>()(
  persist(
    (set) => ({
      viewingAsUserId: defaultViewingAsUserId(),
      setViewingAs: (userId) => set({ viewingAsUserId: userId }),
    }),
    {
      name: "eb-identity",
      skipHydration: true,
    }
  )
);
