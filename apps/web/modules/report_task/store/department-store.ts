import { create } from "zustand";
import type { Department } from "@/modules/report_task/types";

// First-run default only, before any department has been created — once
// ServerStoreSync's GET resolves, whatever's actually saved server-side wins
// (see server-store-sync.tsx). A brand-new org starts with no departments;
// they're created from the settings panel.
const defaultDepartments: Department[] = [];

interface DepartmentStore {
  departments: Department[];
  addDepartment: (d: Omit<Department, "id">) => string;
  updateDepartment: (id: string, patch: Partial<Omit<Department, "id">>) => void;
  removeDepartment: (id: string) => void;
  /** Replaces the whole list in one commit — used by the settings panel's Save button, which stages edits locally until then. */
  setDepartments: (departments: Department[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "departments") in
// store-hydrator.tsx — shared org-wide config, not per-browser. `data/mock.ts`
// re-exports `departments` as a live view over this store (see mock.ts) so
// every existing consumer (permissions, dashboards, task/report scoping)
// keeps working unchanged as departments are added/edited/removed.
export const useDepartmentStore = create<DepartmentStore>()((set) => ({
  departments: defaultDepartments,
  addDepartment: (d) => {
    const id = `dep-${crypto.randomUUID()}`;
    set((s) => ({ departments: [...s.departments, { ...d, id }] }));
    return id;
  },
  updateDepartment: (id, patch) =>
    set((s) => ({ departments: s.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
  removeDepartment: (id) => set((s) => ({ departments: s.departments.filter((d) => d.id !== id) })),
  setDepartments: (departments) => set({ departments }),
}));
