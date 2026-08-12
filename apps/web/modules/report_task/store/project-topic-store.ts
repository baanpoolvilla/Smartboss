import { create } from "zustand";
import type { ProjectTopic } from "@/modules/report_task/types";

interface ProjectTopicStore {
  topics: ProjectTopic[];
  addTopic: (name: string) => string;
  removeTopic: (id: string) => void;
  setTopics: (topics: ProjectTopic[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "project-topics") in
// store-hydrator.tsx — shared org-wide config, not per-browser. Starts empty
// (unlike templates' seeded defaults) since not every department groups its
// tasks by project.
export const useProjectTopicStore = create<ProjectTopicStore>()((set) => ({
  topics: [],
  addTopic: (name) => {
    const id = `topic-${crypto.randomUUID()}`;
    set((s) => ({ topics: [...s.topics, { id, name }] }));
    return id;
  },
  removeTopic: (id) => set((s) => ({ topics: s.topics.filter((t) => t.id !== id) })),
  setTopics: (topics) => set({ topics }),
}));
