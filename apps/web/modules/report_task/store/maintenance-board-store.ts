"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BoardKind, MaintenanceBoardItem, WorkOrderReaction } from "@/modules/report_task/lib/maintenance-board";

/**
 * ใบงานซ่อมบนหน้างาน (lib/maintenance-board.ts) + ตัวเลือก "แสดงบนบอร์ด" ในเมนูจัดกลุ่ม
 * kinds จำไว้ในเครื่อง (เปิดครั้งหน้ายังเป็นแบบเดิม) · items/counts ไม่จำ — ดึงใหม่ทุกครั้งที่เปิดบอร์ด
 */
interface MaintenanceBoardState {
  items: MaintenanceBoardItem[];
  loaded: boolean;
  /** ประเภทที่ติ๊กไว้ให้แสดงบนบอร์ด */
  kinds: Record<BoardKind, boolean>;
  /** จำนวนแต่ละประเภทที่ตรงกับตัวกรองอื่นอยู่ตอนนี้ — บอร์ดเป็นคนคำนวณ เมนูเอาไปโชว์ */
  counts: Record<BoardKind, number>;
  load: () => Promise<void>;
  toggleKind: (kind: BoardKind) => void;
  setCounts: (counts: Record<BoardKind, number>) => void;
  /** ติดสติกเกอร์บนใบงานซ่อม — คืนข้อความ error (ไม่ผ่าน) หรือ null (สำเร็จ) */
  react: (workOrderId: string, stickerId: string) => Promise<string | null>;
  /** ยกเลิกสติกเกอร์ (กดผิด) — คืนคะแนนให้ */
  unreact: (reactionId: string) => Promise<string | null>;
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "บันทึกสติกเกอร์ไม่สำเร็จ ลองใหม่อีกครั้ง";
}

let inflight: Promise<void> | null = null;

export const useMaintenanceBoardStore = create<MaintenanceBoardState>()(
  persist(
    (set) => ({
      items: [],
      loaded: false,
      kinds: { task: true, wo: true },
      counts: { task: 0, wo: 0 },
      load: () => {
        if (inflight) return inflight;
        inflight = (async () => {
          try {
            const res = await fetch("/api/report-task/maintenance-board", { cache: "no-store" });
            const data = res.ok ? ((await res.json()) as { items?: MaintenanceBoardItem[] }) : null;
            set({ items: data?.items ?? [], loaded: true });
          } catch {
            set({ loaded: true });
          } finally {
            inflight = null;
          }
        })();
        return inflight;
      },
      toggleKind: (kind) =>
        set((s) => {
          const next = { ...s.kinds, [kind]: !s.kinds[kind] };
          // เอาออกหมดไม่ได้ — บอร์ดว่างเปล่าแล้วงงว่าทำไม
          if (!next.task && !next.wo) return s;
          return { kinds: next };
        }),
      react: async (workOrderId, stickerId) => {
        try {
          const res = await fetch("/api/report-task/maintenance-board/reactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workOrderId, stickerId }),
          });
          if (!res.ok) return await errorOf(res);
          const { reaction } = (await res.json()) as { reaction: WorkOrderReaction };
          set((s) => ({
            items: s.items.map((i) =>
              i.kind === "wo" && i.id === workOrderId ? { ...i, reactions: [...(i.reactions ?? []), reaction] } : i
            ),
          }));
          return null;
        } catch {
          return "ส่งข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง";
        }
      },
      unreact: async (reactionId) => {
        try {
          const res = await fetch("/api/report-task/maintenance-board/reactions", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reactionId }),
          });
          if (!res.ok) return await errorOf(res);
          set((s) => ({
            items: s.items.map((i) => ({ ...i, reactions: (i.reactions ?? []).filter((r) => r.id !== reactionId) })),
          }));
          return null;
        } catch {
          return "ส่งข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง";
        }
      },
      setCounts: (counts) =>
        set((s) =>
          s.counts.task === counts.task && s.counts.wo === counts.wo ? s : { counts }
        ),
    }),
    {
      name: "sb-board-kinds",
      partialize: (s) => ({ kinds: s.kinds }),
      // ที่จำไว้ในเครื่องจากตอนยังมี "สั่งซื้อ" (po) — เอาแค่ task/wo ที่ยังมีอยู่ ไม่งั้น key เก่าค้างใน state
      merge: (persisted, current) => {
        const k = (persisted as { kinds?: Partial<Record<BoardKind, boolean>> } | undefined)?.kinds;
        const kinds = { task: k?.task ?? true, wo: k?.wo ?? true };
        return { ...current, kinds: kinds.task || kinds.wo ? kinds : current.kinds };
      },
    }
  )
);
