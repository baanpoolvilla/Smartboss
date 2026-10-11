"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BoardKind, MaintenanceBoardItem } from "@/modules/report_task/lib/maintenance-board";

/**
 * ใบงานซ่อม/สั่งซื้อบนบอร์ดงาน (lib/maintenance-board.ts) + ตัวเลือก "แสดงบนบอร์ด" ในเมนูจัดกลุ่ม
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
}

let inflight: Promise<void> | null = null;

export const useMaintenanceBoardStore = create<MaintenanceBoardState>()(
  persist(
    (set) => ({
      items: [],
      loaded: false,
      kinds: { task: true, wo: true, po: true },
      counts: { task: 0, wo: 0, po: 0 },
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
          if (!next.task && !next.wo && !next.po) return s;
          return { kinds: next };
        }),
      setCounts: (counts) =>
        set((s) =>
          s.counts.task === counts.task && s.counts.wo === counts.wo && s.counts.po === counts.po ? s : { counts }
        ),
    }),
    { name: "sb-board-kinds", partialize: (s) => ({ kinds: s.kinds }) }
  )
);
