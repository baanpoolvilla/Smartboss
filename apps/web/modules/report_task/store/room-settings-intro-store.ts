import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeLocalStorage } from "@/modules/report_task/lib/safe-storage";

/**
 * "เห็นแล้ว" ของแบนเนอร์ต้อนรับในหน้าตั้งค่าห้อง (ReportTopicSettingsPanel) —
 * ต่อคนดู (viewingAsUserId) ไม่ผูกกับห้องไหนห้องหนึ่ง เพราะแบนเนอร์อธิบาย
 * ภาพรวมของหน้าตั้งค่าเอง ไม่ใช่ config เฉพาะห้อง เห็นครั้งแรกที่ไหนก็ถือว่า
 * เข้าใจแนวคิดแล้ว ไม่ต้องเห็นซ้ำทุกห้อง. เก็บ localStorage เหมือน
 * whats-new-store.ts — เป็นแค่ความสะดวกต่อเบราว์เซอร์ ไม่ใช่ state ที่ต้อง
 * sync ข้ามเครื่อง.
 */
interface RoomSettingsIntroStore {
  seenBy: Record<string, boolean>;
  markSeen: (userId: string) => void;
}

export const useRoomSettingsIntroStore = create<RoomSettingsIntroStore>()(
  persist(
    (set) => ({
      seenBy: {},
      markSeen: (userId) => set((s) => ({ seenBy: { ...s.seenBy, [userId]: true } })),
    }),
    { name: "eb-room-settings-intro", skipHydration: true, storage: createJSONStorage(() => safeLocalStorage) }
  )
);
