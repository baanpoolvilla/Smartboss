import { create } from "zustand";

export interface PracticeMission {
  id: string;
  title: string;
  description: string;
}

// Six real, distinct interactions on the practice board — trimmed from the
// original wishlist to the ones a single self-contained sandbox page can
// actually validate (a separate "open the sidebar" step doesn't mean
// anything on a one-page sandbox, and "drag a card" vs "change status" are
// kept as two missions because they're two different affordances on the
// same board, worth surfacing separately).
export const practiceMissions: PracticeMission[] = [
  { id: "create-task", title: "สร้างงานแรกของคุณ", description: "กด \"+ สร้างงาน\" แล้วตั้งชื่องานอะไรก็ได้" },
  { id: "assign-member", title: "มอบหมายงานให้เพื่อนร่วมทีม", description: "เปิดงานที่สร้างไว้ แล้วเลือกผู้รับผิดชอบ" },
  { id: "change-status", title: "เปลี่ยนสถานะงาน", description: "เปิดงาน แล้วเปลี่ยนสถานะเป็น \"กำลังทำ\"" },
  { id: "drag-card", title: "ลากการ์ดข้ามคอลัมน์", description: "ลากการ์ดงานจากคอลัมน์หนึ่งไปวางอีกคอลัมน์" },
  { id: "add-comment", title: "แสดงความคิดเห็นในงาน", description: "เปิดงานแล้วพิมพ์คอมเมนต์อะไรก็ได้" },
  { id: "complete-task", title: "ทำงานให้เสร็จสมบูรณ์", description: "เปลี่ยนสถานะงานเป็น \"เสร็จสิ้น\"" },
];

interface PracticeMissionStore {
  completed: string[];
  complete: (id: string) => void;
  reset: () => void;
}

/** Ephemeral, in-memory — resets every time practice mode is (re)entered, same "everything is temporary" rule as the practice task data itself. */
export const usePracticeMissionStore = create<PracticeMissionStore>((set, get) => ({
  completed: [],
  complete: (id) => {
    if (get().completed.includes(id)) return;
    set((s) => ({ completed: [...s.completed, id] }));
  },
  reset: () => set({ completed: [] }),
}));
