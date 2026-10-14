import { create } from "zustand";
import type { User } from "@/modules/report_task/types";
import { uuid } from "@/modules/report_task/lib/uuid";

// ว่างจนกว่ารายชื่อจริง (core.users ผ่าน ServerStoreSync "employees") จะโหลดเสร็จ — เดิมใส่รายชื่อ
// ตัวอย่างของต้นทางไว้ 15 คน (usr-01..usr-15 เช่น "อรุณ ไชยวัฒน์ CEO") ซึ่งโผล่ในกล่อง @แท็ก
// และรายการต่าง ๆ ของบริษัทจริงทุกครั้งที่เปิดก่อนโหลดเสร็จหรือโหลดไม่สำเร็จ ("ข้อมูล test ยังขึ้นอยู่")
// ตัวเองถูกเติมเข้ามาทันทีที่ scaffold mount (report-task-scaffold.tsx) ส่วนจุดที่อ่านตัวเองก่อนนั้น
// ต้องรับมือกับ getUser() ที่คืน undefined เอง
const defaultEmployees: User[] = [];

interface EmployeeStore {
  employees: User[];
  /** False until the real directory (core.users, via ServerStoreSync
   * "employees") has landed — until then `employees` is still the demo seed
   * above, which must never be shown as a room's real members or, worse,
   * saved into a room's visibility (fake usr-XX ids in real data). */
  loaded: boolean;
  addEmployee: (u: Omit<User, "id">) => string;
  updateEmployee: (id: string, patch: Partial<Omit<User, "id">>) => void;
  removeEmployee: (id: string) => void;
  /** Replaces the whole list in one commit — used by the settings panel's Save button, which stages edits locally until then. */
  setEmployees: (employees: User[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "employees") in
// store-hydrator.tsx — shared org-wide config, not per-browser. `data/mock.ts`
// re-exports `users` as a live view over this store (see mock.ts) so every
// existing consumer (permissions, dashboards, task/report assignment) keeps
// working unchanged as employees are added/edited/removed.
export const useEmployeeStore = create<EmployeeStore>()((set) => ({
  employees: defaultEmployees,
  loaded: false,
  addEmployee: (u) => {
    const id = `usr-${uuid()}`;
    set((s) => ({ employees: [...s.employees, { ...u, id }] }));
    return id;
  },
  updateEmployee: (id, patch) =>
    set((s) => ({ employees: s.employees.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),
  removeEmployee: (id) => set((s) => ({ employees: s.employees.filter((u) => u.id !== id) })),
  // Callers of setEmployees (the settings panel's Save, the outside-report-
  // task bootstraps in report-notification-sync/issue-report-bar-button/
  // app-tile-review-badge) all pass the real directory, so it counts as loaded.
  setEmployees: (employees) => set({ employees, loaded: true }),
}));
