import { create } from "zustand";
import { LATE_PENALTY_POINTS } from "@/modules/report_task/store/task-store";

interface PenaltySettingsStore {
  /** Default points docked when a lead marks an overdue task (editable, case-by-case). */
  defaultPoints: number;
  setDefaultPoints: (points: number) => void;
}

// Server-synced via ServerStoreSync (apiKey "penalty-settings") in
// store-hydrator.tsx — shared org-wide config, not per-browser.
export const usePenaltySettingsStore = create<PenaltySettingsStore>()((set) => ({
  defaultPoints: LATE_PENALTY_POINTS,
  setDefaultPoints: (points) => set({ defaultPoints: Math.max(1, Math.round(points) || 1) }),
}));
