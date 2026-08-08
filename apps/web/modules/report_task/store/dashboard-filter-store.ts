import { create } from "zustand";
import type { DatePreset } from "@/modules/report_task/lib/date-filter";
import type { TaskPriority } from "@/modules/report_task/types";

interface DashboardFilterStore {
  personId: string;
  departmentId: string;
  priority: TaskPriority | "all";
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  setPersonId: (id: string) => void;
  setDepartmentId: (id: string) => void;
  setPriority: (priority: TaskPriority | "all") => void;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
}

export const useDashboardFilterStore = create<DashboardFilterStore>((set) => ({
  personId: "all",
  departmentId: "all",
  priority: "all",
  preset: "all",
  customFrom: "",
  customTo: "",
  setPersonId: (id) => set({ personId: id }),
  setDepartmentId: (id) => set({ departmentId: id }),
  setPriority: (priority) => set({ priority }),
  setPreset: (preset) => set({ preset }),
  setCustomRange: (from, to) => set({ customFrom: from, customTo: to }),
}));
