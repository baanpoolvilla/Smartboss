import { create } from "zustand";

export interface TaskReviewSettings {
  /** Default true — a department head can sign off ("ผ่าน/ไม่ผ่าน") a task
   * touching their department, on top of the owner who always can. Turning
   * this off leaves only the owner plus whoever's in extraReviewerIds below —
   * for a company that wants review centralized instead of per-department. */
  headsCanReview: boolean;
  /** Individuals granted review rights beyond the role-based rule above —
   * e.g. a senior employee trusted to sign off work who isn't an official
   * department head. Always allowed to review any task, regardless of
   * department or headsCanReview. */
  extraReviewerIds: string[];
}

interface TaskReviewSettingsStore {
  settings: TaskReviewSettings;
  setHeadsCanReview: (v: boolean) => void;
  setExtraReviewerIds: (ids: string[]) => void;
}

const defaultSettings: TaskReviewSettings = { headsCanReview: true, extraReviewerIds: [] };

// Server-synced via ServerStoreSync (apiKey "task-review-settings") in
// store-hydrator.tsx — shared org-wide config, not per-browser.
export const useTaskReviewSettingsStore = create<TaskReviewSettingsStore>()((set) => ({
  settings: defaultSettings,
  setHeadsCanReview: (headsCanReview) => set((s) => ({ settings: { ...s.settings, headsCanReview } })),
  setExtraReviewerIds: (extraReviewerIds) => set((s) => ({ settings: { ...s.settings, extraReviewerIds } })),
}));
