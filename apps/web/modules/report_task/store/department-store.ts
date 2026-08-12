import { create } from "zustand";
import type { Department } from "@/modules/report_task/types";

// First-run default only, before the server GET resolves (see
// server-store-sync.tsx). Departments themselves now come from
// core.departments (managed at /admin/departments) — this store only ever
// holds the merged view the server hands back (name + this module's own
// color/head overlay, see lib/db/departments.ts). Creating/renaming/deleting
// a department happens at /admin, not here.
const defaultDepartments: Department[] = [];

interface DepartmentStore {
  departments: Department[];
  updateDepartment: (id: string, patch: Partial<Omit<Department, "id">>) => void;
  /** Replaces the whole list in one commit — used by the settings panel's Save button, which stages edits locally until then. */
  setDepartments: (departments: Department[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "departments") in
// store-hydrator.tsx — shared org-wide config, not per-browser. `lib/directory.ts`
// re-exports `departments` as a live view over this store so every existing
// consumer (permissions, dashboards, task/report scoping) keeps working
// unchanged as the underlying core departments or their color/head change.
export const useDepartmentStore = create<DepartmentStore>()((set) => ({
  departments: defaultDepartments,
  updateDepartment: (id, patch) =>
    set((s) => ({ departments: s.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
  setDepartments: (departments) => set({ departments }),
}));
