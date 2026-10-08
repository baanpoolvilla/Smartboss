"use client";

import { create } from "zustand";
import { toast } from "sonner";
import { DEFAULT_PREFS, normalizePrefs, type NotifPrefs } from "./prefs";

interface NotifPrefsStore {
  prefs: NotifPrefs;
  loaded: boolean;
  load: () => Promise<void>;
  /** เปลี่ยนแล้วมีผลทันทีบนจอ แล้วค่อยบันทึก — บันทึกไม่ผ่านถอยกลับค่าเดิม + แจ้ง */
  save: (next: NotifPrefs) => Promise<void>;
}

/**
 * ค่าตั้งแจ้งเตือนของตัวเอง (ดู prefs.ts) — กระดิ่งใช้ซ่อนหัวข้อที่ปิด, หน้าตั้งค่าใช้แก้
 * โหลดไม่ได้ = ค่าเริ่มต้น "เห็นทั้งหมด" (แจ้งเตือนไม่หายเงียบ)
 */
export const useNotifPrefs = create<NotifPrefsStore>()((set, get) => ({
  prefs: DEFAULT_PREFS,
  loaded: false,
  async load() {
    try {
      const res = await fetch("/api/notifications/preferences", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { prefs?: unknown };
      set({ prefs: normalizePrefs(data.prefs), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async save(next) {
    const prev = get().prefs;
    set({ prefs: next });
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { prefs?: unknown };
      set({ prefs: normalizePrefs(data.prefs) });
    } catch {
      set({ prefs: prev });
      toast.error("บันทึกตั้งค่าแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  },
}));
