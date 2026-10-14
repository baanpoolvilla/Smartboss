import { create } from "zustand";

/** คำร้อง "ขอส่งย้อนหลัง" ของตัวเองที่ CEO อนุมัติแล้ว รอส่งรีพอต — จาก GET /api/report-task/reports/penalty-requests */
export interface RetroSubmitRequest {
  id: string;
  userId: string;
  topicId: string;
  roundId: string;
  day: string;
  points: number;
  /** ISO — 00:00 วันถัดจากวันตัดรอบ (ส่งได้ก่อนเวลานี้) */
  retroDeadline: string;
}

interface RetroSubmitStore {
  requests: RetroSubmitRequest[];
  /** คำร้องที่กำลังส่งรีพอตย้อนหลังอยู่ — ช่องเขียนรีพอต (report-composer.tsx) เปลี่ยนเป็นโหมดส่งย้อนหลัง */
  target: RetroSubmitRequest | null;
  setTarget: (r: RetroSubmitRequest | null) => void;
  load: () => Promise<void>;
}

export const useRetroSubmitStore = create<RetroSubmitStore>()((set) => ({
  requests: [],
  target: null,
  setTarget: (target) => set({ target }),
  load: async () => {
    try {
      const res = await fetch("/api/report-task/reports/penalty-requests");
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: (RetroSubmitRequest & { type: string; status: string; awaitingPost?: boolean; fulfilledAt?: string })[];
      };
      set({
        requests: (data.items ?? []).filter(
          (i) => i.type === "retroactive" && i.status === "approved" && i.awaitingPost === true && !i.fulfilledAt
        ),
      });
    } catch {
      // ออฟไลน์ — ปุ่มส่งย้อนหลังแค่ยังไม่ขึ้น
    }
  },
}));
