import { create } from "zustand";
import type { DatePreset } from "@/modules/report_task/lib/date-filter";

// §7.4 — the "ความสำคัญ" filter was dropped from the Dashboard entirely (not
// from the Tasks page's own kanban/task-filters.tsx, which keeps its own
// separate priority filter untouched).
interface DashboardFilterStore {
  personId: string;
  departmentId: string;
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  setPersonId: (id: string) => void;
  setDepartmentId: (id: string) => void;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
}

export const useDashboardFilterStore = create<DashboardFilterStore>((set) => ({
  personId: "all",
  departmentId: "all",
  preset: "all",
  customFrom: "",
  customTo: "",
  setPersonId: (id) => set({ personId: id }),
  setDepartmentId: (id) => set({ departmentId: id }),
  setPreset: (preset) => set({ preset }),
  setCustomRange: (from, to) => set({ customFrom: from, customTo: to }),
}));
