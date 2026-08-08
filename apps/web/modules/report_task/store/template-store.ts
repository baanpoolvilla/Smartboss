import { create } from "zustand";
import type { TaskPriority } from "@/modules/report_task/types";

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  priority: TaskPriority;
}

const defaultTemplates: TaskTemplate[] = [
  { id: "tpl-bug", name: "แก้บั๊ก", title: "แก้บั๊ก: ", description: "อาการ:\nขั้นตอนที่ทำให้เกิด:\nผลที่คาดหวัง:", priority: "high" },
  { id: "tpl-content", name: "งานคอนเทนต์", title: "คอนเทนต์: ", description: "หัวข้อ:\nช่องทาง:\nประเด็นหลัก:", priority: "medium" },
  { id: "tpl-review", name: "รีวิว/ตรวจงาน", title: "ตรวจงาน: ", description: "สิ่งที่ต้องตรวจ:\nเกณฑ์ผ่าน:", priority: "medium" },
];

interface TemplateStore {
  templates: TaskTemplate[];
  addTemplate: (t: Omit<TaskTemplate, "id">) => void;
  removeTemplate: (id: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "templates") in
// store-hydrator.tsx — shared org-wide config, not per-browser.
export const useTemplateStore = create<TemplateStore>()((set) => ({
  templates: defaultTemplates,
  addTemplate: (t) => set((s) => ({ templates: [...s.templates, { ...t, id: `tpl-${crypto.randomUUID()}` }] })),
  removeTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
}));
