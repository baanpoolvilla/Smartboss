import { create } from "zustand";
import type { Department } from "@/modules/report_task/types";

// Seed matches the org chart data/mock.ts shipped with before this store
// existed — first-run default only; once ServerStoreSync's GET resolves,
// whatever's actually saved server-side wins (see server-store-sync.tsx).
const defaultDepartments: Department[] = [
  { id: "dep-eng", name: "วิศวกรรม", color: "var(--chart-blue)", headId: "usr-01" },
  { id: "dep-design", name: "ดีไซน์", color: "var(--chart-violet)", headId: "usr-04" },
  { id: "dep-marketing", name: "การตลาด", color: "var(--chart-orange)", headId: "usr-06" },
  { id: "dep-sales", name: "ฝ่ายขาย", color: "var(--chart-amber)", headId: "usr-08" },
  { id: "dep-ops", name: "ปฏิบัติการ", color: "var(--chart-green)", headId: "usr-10" },
  { id: "dep-support", name: "บริการลูกค้า", color: "var(--chart-pink)", headId: "usr-12" },
];

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
