import { create } from "zustand";

/** Shape of a maintenance notification once it's crossed the wire — Prisma's
 * `DateTime`/nullable fields become plain strings/null after JSON.stringify. */
export interface MaintenanceNotif {
  id: string;
  title: string;
  body: string | null;
  type: string;
  referenceId: string | null;
  createdAt: string;
  readAt: string | null;
}

interface MaintenanceNotifStore {
  items: MaintenanceNotif[];
  /** "วันนี้ทั้งบริษัทมีอะไรเกิดขึ้นบ้าง" — เฉพาะเจ้าของบริษัท (เซิร์ฟเวอร์เช็ค
   * สิทธิ์เองใน route, ดูคอมเมนต์ที่นั่น) ว่างเปล่าเสมอสำหรับคนอื่น อ่านอย่าง
   * เดียว ห้ามมี markRead ให้แถวพวกนี้ — เป็นแจ้งเตือนของคนอื่น ไม่ใช่ของ
   * เจ้าของบริษัทเอง (ดู listOrgNotifications's doc comment) */
  orgItems: MaintenanceNotif[];
  /** `true` once the first fetch has completed (success or failure) — lets
   * callers avoid flashing "no notifications" before data has even loaded. */
  loaded: boolean;
  refresh: (opts?: { includeOrgActivity?: boolean }) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markReadByReference: (referenceId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/** Client-side mirror of `core.notifications` for the logged-in user (real
 * auth session, via /api/notifications/maintenance — NOT the report_task
 * module's demo `viewingAsUserId`). Plain zustand, not persisted — this is
 * server-owned data, re-fetched on demand (mount + whenever the bell
 * dropdown opens) rather than kept in sync continuously like the
 * report_task store's own server-synced state. */
export const useMaintenanceNotifStore = create<MaintenanceNotifStore>()((set, get) => ({
  items: [],
  orgItems: [],
  loaded: false,
  async refresh(opts) {
    try {
      const url = opts?.includeOrgActivity ? "/api/notifications/maintenance?scope=org" : "/api/notifications/maintenance";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: MaintenanceNotif[]; orgItems?: MaintenanceNotif[] };
      set({ items: data.items, orgItems: data.orgItems ?? [], loaded: true });
    } catch {
      // Network hiccup/not logged in yet — leave whatever's already loaded
      // in place rather than clearing a good list out from under the user.
      set({ loaded: true });
    }
  },
  async markRead(id) {
    const prev = get().items;
    set({ items: prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) });
    try {
      await fetch("/api/notifications/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      set({ items: prev });
    }
  },
  /** ใช้ตอนเปิดหน้ารายละเอียดของเรื่องที่แจ้งเตือนพูดถึงตรงๆ (เช่น หน้าใบงาน) —
   * มาร์คอ่านทุกแจ้งเตือนที่ referenceId ตรงกันในคราวเดียว ไม่ต้องรอกดที่กระดิ่ง
   * (ดู doc ของ markReadByReference ฝั่ง data/notify.ts) */
  async markReadByReference(referenceId) {
    const prev = get().items;
    const now = new Date().toISOString();
    set({
      items: prev.map((n) => (n.referenceId === referenceId ? { ...n, readAt: n.readAt ?? now } : n)),
    });
    try {
      await fetch("/api/notifications/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceId }),
      });
    } catch {
      set({ items: prev });
    }
  },
  async markAllRead() {
    const prev = get().items;
    const now = new Date().toISOString();
    set({ items: prev.map((n) => (n.readAt ? n : { ...n, readAt: now })) });
    try {
      await fetch("/api/notifications/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      set({ items: prev });
    }
  },
}));
