"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BoardKind, MaintenanceBoardItem, WoType, WorkOrderReaction } from "@/modules/report_task/lib/maintenance-board";

const ALL_WO_TYPES: Record<WoType, boolean> = { normal: true, pm: true, auto: true, po: true };

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
  /** ประเภทย่อยของใบงานซ่อมที่ติ๊กไว้ (ซ่อมทั่วไป/PM/อัตโนมัติ/มี PO) — จำในเครื่องเหมือน kinds */
  woTypes: Record<WoType, boolean>;
  /** จำนวนใบงานแต่ละประเภท (หลังตัวกรองอื่น ก่อนติ๊กประเภท) — บอร์ดคำนวณ เมนูเอาไปโชว์ */
  woTypeCounts: Record<WoType, number>;
  toggleWoType: (t: WoType) => void;
  showAllWoTypes: () => void;
  setWoTypeCounts: (counts: Record<WoType, number>) => void;
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
      woTypes: ALL_WO_TYPES,
      woTypeCounts: { normal: 0, pm: 0, auto: 0, po: 0 },
      toggleWoType: (t) =>
        set((s) => {
          const next = { ...s.woTypes, [t]: !s.woTypes[t] };
          // ติ๊กออกหมดไม่ได้ — อยากซ่อนใบงานทั้งหมดให้ติ๊ก "ใบงานซ่อม" ออกแทน
          if (!Object.values(next).some(Boolean)) return s;
          return { woTypes: next };
        }),
      showAllWoTypes: () => set({ woTypes: ALL_WO_TYPES }),
      setWoTypeCounts: (counts) =>
        set((s) =>
          (Object.keys(counts) as WoType[]).every((k) => s.woTypeCounts[k] === counts[k]) ? s : { woTypeCounts: counts }
        ),
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
      partialize: (s) => ({ kinds: s.kinds, woTypes: s.woTypes }),
      // ที่จำไว้ในเครื่องจากตอนยังมี "สั่งซื้อ" (po) — เอาแค่ task/wo ที่ยังมีอยู่ ไม่งั้น key เก่าค้างใน state
      merge: (persisted, current) => {
        const p = persisted as { kinds?: Partial<Record<BoardKind, boolean>>; woTypes?: Partial<Record<WoType, boolean>> } | undefined;
        const k = p?.kinds;
        const kinds = { task: k?.task ?? true, wo: k?.wo ?? true };
        const w = p?.woTypes;
        const woTypes = { normal: w?.normal ?? true, pm: w?.pm ?? true, auto: w?.auto ?? true, po: w?.po ?? true };
        return {
          ...current,
          kinds: kinds.task || kinds.wo ? kinds : current.kinds,
          woTypes: Object.values(woTypes).some(Boolean) ? woTypes : current.woTypes,
        };
      },
    }
  )
);
