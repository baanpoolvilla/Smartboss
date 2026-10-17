import { create } from "zustand";

import { uuid } from "@/modules/report_task/lib/uuid";
import type {
  Project,
  ProjectMilestone,
  ProjectSection,
  ProjectStatus,
  ProjectTemplate,
  ProjectTemplateItem,
} from "@/modules/report_task/types";

/**
 * โปรเจกต์ + แม่แบบโปรเจกต์ — ซิงก์กับเซิร์ฟเวอร์ผ่าน ServerStoreSync (คีย์ "projects" / "project-templates")
 * ใน store-hydrator.tsx · ตัวงานของโปรเจกต์อยู่ใน task-store (task.project) ที่นี่เก็บแค่โครงโปรเจกต์
 * (ช่วงงาน, Milestone, สมาชิก, อัปเดตสถานะ)
 */

const now = () => new Date().toISOString();

function tplItem(
  key: string,
  sectionKey: string,
  name: string,
  role: string,
  off: number,
  dur: number,
  dependsOn: string[] = [],
  milestone = false,
  extra: Partial<ProjectTemplateItem> = {}
): ProjectTemplateItem {
  return { key, sectionKey, name, role, off, dur, milestone, dependsOn, description: "", checklist: [], ...extra };
}

/** แม่แบบตั้งต้น 3 อัน — บริษัทแก้/ลบได้ ใช้ตอนที่เซิร์ฟเวอร์ยังไม่มีแม่แบบเลย */
export const DEFAULT_PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "tpl-renovate",
    name: "รีโนเวท / ซ่อมบ้านพัก",
    description: "งานซ่อมใหญ่ที่ต้องปิดบ้าน",
    workdays: true,
    anchor: "start",
    sections: [
      { key: "s1", name: "สำรวจ & ประเมิน" },
      { key: "s2", name: "งานโครงสร้าง" },
      { key: "s3", name: "งานภายใน" },
      { key: "s4", name: "ส่งมอบ" },
    ],
    items: [
      tplItem("a", "s1", "สำรวจจุดเสีย + ถ่ายรูป", "ช่าง", 0, 2, [], false, {
        description: "ถ่ายรูปทุกจุดที่เสีย + วัดขนาด ส่งเข้าห้องแชทโปรเจกต์",
        checklist: ["ถ่ายรูปก่อนซ่อมทุกจุด", "วัดขนาดพื้นที่", "ระบุวัสดุที่ต้องใช้"],
      }),
      tplItem("b", "s1", "ประเมินราคา / สั่งวัสดุ", "จัดซื้อ", 2, 3, ["a"]),
      tplItem("c", "s1", "เจ้าของอนุมัติงบ", "", 5, 0, ["b"], true),
      tplItem("d", "s2", "รื้อของเดิม", "ช่าง", 5, 3, ["c"]),
      tplItem("e", "s2", "ซ่อมโครงสร้าง / กันซึม", "ช่าง", 8, 5, ["d"]),
      tplItem("f", "s3", "ฉาบ + ทาสี", "ช่าง", 13, 6, ["e"]),
      tplItem("g", "s4", "ทำความสะอาดใหญ่", "แม่บ้าน", 19, 2, ["f"], false, {
        checklist: ["ดูดฝุ่น + ถูพื้นทุกห้อง", "เช็ดกระจก", "เปลี่ยนผ้าปูที่นอน", "เติมของใช้ห้องน้ำ"],
      }),
      tplItem("h", "s4", "ตรวจรับงาน", "", 21, 0, ["g"], true, {
        description: "เจ้าของโปรเจกต์ + หัวหน้าแม่บ้าน เดินตรวจด้วยกัน",
      }),
      tplItem("i", "s4", "ถ่ายรูปใหม่ลง OTA", "ฝ่ายขาย/OTA", 21, 2, ["h"]),
    ],
    usedCount: 0,
    createdBy: "system",
    updatedAt: "2026-10-16T00:00:00.000Z",
  },
  {
    id: "tpl-open-house",
    name: "เปิดบ้านใหม่",
    description: "บ้านหลังใหม่เข้าระบบ จนเปิดรับลูกค้า",
    workdays: true,
    anchor: "end",
    sections: [
      { key: "s1", name: "เตรียมบ้าน" },
      { key: "s2", name: "ขาย" },
    ],
    items: [
      tplItem("a", "s1", "ตรวจสภาพบ้าน + ทำรายการของขาด", "แม่บ้าน", 0, 2),
      tplItem("b", "s1", "ซื้อของใช้ / ของตกแต่ง", "จัดซื้อ", 2, 4, ["a"]),
      tplItem("c", "s1", "จัดบ้าน + ทำความสะอาด", "แม่บ้าน", 6, 2, ["b"]),
      tplItem("d", "s2", "ถ่ายรูป + วิดีโอ", "ฝ่ายขาย/OTA", 8, 1, ["c"]),
      tplItem("e", "s2", "ลงประกาศ OTA ทุกช่องทาง", "ฝ่ายขาย/OTA", 9, 3, ["d"]),
      tplItem("f", "s2", "เปิดรับลูกค้า", "", 12, 0, ["e"], true),
    ],
    usedCount: 0,
    createdBy: "system",
    updatedAt: "2026-10-16T00:00:00.000Z",
  },
  {
    id: "tpl-campaign",
    name: "แคมเปญการตลาด",
    description: "แคมเปญโฆษณา 1 รอบ",
    workdays: false,
    anchor: "start",
    sections: [
      { key: "s1", name: "เตรียม" },
      { key: "s2", name: "ยิงจริง" },
    ],
    items: [
      tplItem("a", "s1", "วางแผน + งบ", "การตลาด", 0, 3),
      tplItem("b", "s1", "ทำสื่อ (ภาพ/วิดีโอ/แคปชัน)", "การตลาด", 3, 7, ["a"]),
      tplItem("c", "s1", "CEO อนุมัติสื่อ", "", 10, 0, ["b"], true),
      tplItem("d", "s2", "ยิงโฆษณา", "การตลาด", 10, 14, ["c"]),
      tplItem("e", "s2", "สรุปผล + รายงาน", "การตลาด", 24, 2, ["d"]),
    ],
    usedCount: 0,
    createdBy: "system",
    updatedAt: "2026-10-16T00:00:00.000Z",
  },
];

interface ProjectStore {
  projects: Project[];
  templates: ProjectTemplate[];
  /** โหลดจากเซิร์ฟเวอร์ครบแล้ว (ตั้งใน store-hydrator) — ก่อนนั้นห้ามสร้าง/แก้: ตอนโหลดเสร็จข้อมูลเซิร์ฟเวอร์ทับของในเครื่อง
   *  ของที่สร้างก่อนโหลดเสร็จจะหายเงียบ ๆ (เจอจากเทสต์บน localhost 17/10/2569) */
  projectsLoaded: boolean;
  templatesLoaded: boolean;
  setProjects: (p: Project[]) => void;
  setTemplates: (t: ProjectTemplate[]) => void;

  addProject: (p: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  removeProject: (id: string) => void;

  addSection: (projectId: string, name: string) => string;
  renameSection: (projectId: string, sectionId: string, name: string) => void;
  removeSection: (projectId: string, sectionId: string) => void;

  addMilestone: (projectId: string, m: Omit<ProjectMilestone, "id">) => string;
  updateMilestone: (projectId: string, id: string, patch: Partial<ProjectMilestone>) => void;
  removeMilestone: (projectId: string, id: string) => void;

  addUpdate: (projectId: string, status: ProjectStatus, text: string, by: string) => void;

  upsertTemplate: (t: ProjectTemplate) => void;
  removeTemplate: (id: string) => void;
}

function patchProject(list: Project[], id: string, fn: (p: Project) => Project): Project[] {
  return list.map((p) => (p.id === id ? { ...fn(p), updatedAt: now() } : p));
}

export const useProjectStore = create<ProjectStore>()((set) => ({
  projects: [],
  templates: DEFAULT_PROJECT_TEMPLATES,
  projectsLoaded: false,
  templatesLoaded: false,
  setProjects: (projects) => set({ projects }),
  setTemplates: (templates) => set({ templates }),

  addProject: (p) => set((s) => ({ projects: [p, ...s.projects] })),
  updateProject: (id, patch) => set((s) => ({ projects: patchProject(s.projects, id, (p) => ({ ...p, ...patch })) })),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

  addSection: (projectId, name) => {
    const id = `psec-${uuid()}`;
    const sec: ProjectSection = { id, name };
    set((s) => ({ projects: patchProject(s.projects, projectId, (p) => ({ ...p, sections: [...p.sections, sec] })) }));
    return id;
  },
  renameSection: (projectId, sectionId, name) =>
    set((s) => ({
      projects: patchProject(s.projects, projectId, (p) => ({ ...p, sections: p.sections.map((x) => (x.id === sectionId ? { ...x, name } : x)) })),
    })),
  removeSection: (projectId, sectionId) =>
    set((s) => ({
      projects: patchProject(s.projects, projectId, (p) => {
        const rest = p.sections.filter((x) => x.id !== sectionId);
        const fallback = rest[0]?.id ?? sectionId;
        return { ...p, sections: rest, milestones: p.milestones.map((m) => (m.sectionId === sectionId ? { ...m, sectionId: fallback } : m)) };
      }),
    })),

  addMilestone: (projectId, m) => {
    const id = `pms-${uuid()}`;
    set((s) => ({ projects: patchProject(s.projects, projectId, (p) => ({ ...p, milestones: [...p.milestones, { ...m, id }] })) }));
    return id;
  },
  updateMilestone: (projectId, id, patch) =>
    set((s) => ({
      projects: patchProject(s.projects, projectId, (p) => ({ ...p, milestones: p.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
    })),
  removeMilestone: (projectId, id) =>
    set((s) => ({
      projects: patchProject(s.projects, projectId, (p) => ({
        ...p,
        milestones: p.milestones
          .filter((m) => m.id !== id)
          .map((m) => ({ ...m, dependsOn: (m.dependsOn ?? []).filter((d) => d !== id) })),
      })),
    })),

  addUpdate: (projectId, status, text, by) =>
    set((s) => ({
      projects: patchProject(s.projects, projectId, (p) => ({
        ...p,
        updates: [{ id: `pup-${uuid()}`, status, text, by, at: now() }, ...p.updates],
        // ปิดโปรเจกต์ด้วยสถานะ เสร็จแล้ว/ยกเลิก/พักไว้ — อัปเดตอื่นเปิดกลับมา
        closedStatus: status === "done" || status === "dropped" || status === "hold" ? status : undefined,
      })),
    })),

  upsertTemplate: (t) =>
    set((s) => ({
      templates: s.templates.some((x) => x.id === t.id)
        ? s.templates.map((x) => (x.id === t.id ? { ...t, updatedAt: now() } : x))
        : [...s.templates, { ...t, updatedAt: now() }],
    })),
  removeTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
}));
