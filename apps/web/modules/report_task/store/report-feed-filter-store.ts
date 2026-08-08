import { create } from "zustand";
import type { DatePreset } from "@/modules/report_task/lib/date-filter";

/**
 * Date-range filter for the Report (report-feed compliance) analytics tab —
 * kept separate from useReportFilterStore (Task reports) since the two
 * dashboards are meant to be filterable independently ("แยก task แยก
 * report"). Same shape as the Task store's date fields, no cross-filter dim
 * (a click-to-filter chart isn't part of this tab).
 */
interface ReportFeedFilterStore {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
}

export const useReportFeedFilterStore = create<ReportFeedFilterStore>((set) => ({
  preset: "month",
  customFrom: "",
  customTo: "",
  setPreset: (preset) => set({ preset }),
  setCustomRange: (customFrom, customTo) => set({ customFrom, customTo }),
}));
