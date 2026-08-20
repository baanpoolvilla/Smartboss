import { create } from "zustand";
import { topicColors } from "@/modules/report_task/store/report-feed-store";

export interface ReportTag {
  id: string;
  name: string;
  color: string;
}

interface ReportTagStore {
  tags: ReportTag[];
  addTag: (name: string, color?: string) => string;
  removeTag: (id: string) => void;
  setTags: (tags: ReportTag[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "report-tags") in
// store-hydrator.tsx — shared org-wide vocabulary, same "curated list you
// pick from" pattern as useProjectTopicStore (topics on Kanban tasks), just
// scoped to report-feed posts instead. Deliberately curated rather than
// freeform text: a fixed picklist keeps the filter dropdown meaningful (no
// "ด่วน" vs "ด่วนมาก" typo-splitting the same idea into two unfilterable
// tags). Starts empty — not every company organizes its reports by topic.
export const useReportTagStore = create<ReportTagStore>()((set) => ({
  tags: [],
  addTag: (name, color) => {
    const id = `rtag-${crypto.randomUUID()}`;
    set((s) => ({ tags: [...s.tags, { id, name, color: color ?? topicColors[s.tags.length % topicColors.length]! }] }));
    return id;
  },
  removeTag: (id) => set((s) => ({ tags: s.tags.filter((t) => t.id !== id) })),
  setTags: (tags) => set({ tags }),
}));
