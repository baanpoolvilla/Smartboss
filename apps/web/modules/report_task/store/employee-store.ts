import { create } from "zustand";
import type { User } from "@/modules/report_task/types";
import { uuid } from "@/modules/report_task/lib/uuid";

// Seed matches the org chart data/mock.ts shipped with before this store
// existed — first-run default only; once ServerStoreSync's GET resolves,
// whatever's actually saved server-side wins (see server-store-sync.tsx).
const defaultEmployees: User[] = [
  { id: "usr-01", name: "สมชาย ศรีสุข", email: "somchai@easyboss.io", avatar: "สช", role: "หัวหน้าฝ่ายวิศวกรรม", departmentId: "dep-eng" },
  { id: "usr-02", name: "นภัทร เจริญพร", email: "napat@easyboss.io", avatar: "นภ", role: "วิศวกร Frontend", departmentId: "dep-eng" },
  { id: "usr-03", name: "กัญญา วัฒนา", email: "kanya@easyboss.io", avatar: "กว", role: "วิศวกร Backend", departmentId: "dep-eng" },
  { id: "usr-04", name: "พิมพ์ชนก บุญมา", email: "pimchanok@easyboss.io", avatar: "พช", role: "หัวหน้าฝ่ายดีไซน์", departmentId: "dep-design" },
  { id: "usr-05", name: "ธนวัฒน์ รุ่งเรือง", email: "thanawat@easyboss.io", avatar: "ธว", role: "โปรดักต์ดีไซเนอร์", departmentId: "dep-design" },
  { id: "usr-06", name: "สุดา อินทรา", email: "suda@easyboss.io", avatar: "สด", role: "หัวหน้าฝ่ายการตลาด", departmentId: "dep-marketing" },
  { id: "usr-07", name: "เอกภพ ชัยเจริญ", email: "ekapop@easyboss.io", avatar: "อภ", role: "นักวางกลยุทธ์คอนเทนต์", departmentId: "dep-marketing" },
  { id: "usr-08", name: "รัชนี พงษ์ไพศาล", email: "ratchanee@easyboss.io", avatar: "รพ", role: "หัวหน้าฝ่ายขาย", departmentId: "dep-sales" },
  { id: "usr-09", name: "วิชัย แซ่ตั้ง", email: "wichai@easyboss.io", avatar: "วช", role: "เจ้าหน้าที่ฝ่ายขาย", departmentId: "dep-sales" },
  { id: "usr-10", name: "อารียา ทองดี", email: "areeya@easyboss.io", avatar: "อธ", role: "หัวหน้าฝ่ายปฏิบัติการ", departmentId: "dep-ops" },
  { id: "usr-11", name: "ณัฐพงศ์ ศรีวิไล", email: "nattapong@easyboss.io", avatar: "ณศ", role: "นักวิเคราะห์ปฏิบัติการ", departmentId: "dep-ops" },
  { id: "usr-12", name: "ชุติมา วงศ์ทอง", email: "chutima@easyboss.io", avatar: "ชว", role: "หัวหน้าฝ่ายบริการลูกค้า", departmentId: "dep-support" },
  { id: "usr-13", name: "กิตติพัฒน์ เรืองศรี", email: "kittipat@easyboss.io", avatar: "กร", role: "เจ้าหน้าที่บริการลูกค้า", departmentId: "dep-support" },
  { id: "usr-14", name: "บุษบา มณีรัตน์", email: "busaba@easyboss.io", avatar: "บม", role: "วิศวกร QA", departmentId: "dep-eng" },
  // departmentId is cosmetic only here (not head of it, isOwner bypasses
  // every department check) — every User needs one, so it points at eng.
  { id: "usr-15", name: "อรุณ ไชยวัฒน์", email: "arun@easyboss.io", avatar: "อช", role: "CEO (เห็นทุกอย่าง)", departmentId: "dep-eng", isOwner: true },
];

interface EmployeeStore {
  employees: User[];
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
  addEmployee: (u) => {
    const id = `usr-${uuid()}`;
    set((s) => ({ employees: [...s.employees, { ...u, id }] }));
    return id;
  },
  updateEmployee: (id, patch) =>
    set((s) => ({ employees: s.employees.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),
  removeEmployee: (id) => set((s) => ({ employees: s.employees.filter((u) => u.id !== id) })),
  setEmployees: (employees) => set({ employees }),
}));
