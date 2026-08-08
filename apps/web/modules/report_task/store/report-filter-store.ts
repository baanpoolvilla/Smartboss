import { create } from "zustand";
import type { DatePreset } from "@/modules/report_task/lib/date-filter";

export type ReportDim = "status" | "priority" | "department" | "member";

interface ReportFilterStore {
  dim: ReportDim | null;
  value: string | null;
  /** Click a chart element: same one again clears it, a different one switches. */
  toggle: (dim: ReportDim, value: string) => void;
  clear: () => void;
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
}

export const useReportFilterStore = create<ReportFilterStore>((set, get) => ({
  dim: null,
  value: null,
  toggle: (dim, value) => {
    const s = get();
    if (s.dim === dim && s.value === value) set({ dim: null, value: null });
    else set({ dim, value });
  },
  clear: () => set({ dim: null, value: null }),
  preset: "all",
  customFrom: "",
  customTo: "",
  setPreset: (preset) => set({ preset }),
  setCustomRange: (customFrom, customTo) => set({ customFrom, customTo }),
}));
