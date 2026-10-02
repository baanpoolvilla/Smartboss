import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeLocalStorage } from "@/modules/report_task/lib/safe-storage";

/**
 * Per-browser "used most often float to the front" tracking for the report
 * post reaction picker — both the plain emoji row and the scored sticker
 * row share this (keyed "emoji:<char>" / "sticker:<id>" so the two never
 * collide). Deliberately per-user/per-browser, not synced org-wide: "บ่อย"
 * for a CEO handing out score stickers and "บ่อย" for someone just reacting
 * with 👍 are different lists, same reasoning as the dashboard layout prefs.
 *
 * ตัวจริงอยู่ที่เซิร์ฟเวอร์ต่อคน (/api/report-task/me/sticker-usage) — เดิมอยู่แค่ localStorage
 * ปิด LINE / ออกจากระบบ / เปลี่ยนเครื่องแล้วลำดับหาย ตอนนี้ localStorage เป็นแค่ที่พักให้โชว์ได้ทันที
 * ระหว่างรอโหลดจากเซิร์ฟเวอร์ (syncStickerUsageFromServer ตอนเปิดโมดูล)
 */
interface StickerUsageStore {
  counts: Record<string, number>;
  bump: (key: string) => void;
  setCounts: (counts: Record<string, number>) => void;
}

const API = "/api/report-task/me/sticker-usage";

function post(body: unknown): Promise<Record<string, number> | null> {
  return fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => (r.ok ? (r.json() as Promise<{ counts: Record<string, number> }>) : null))
    .then((j) => j?.counts ?? null)
    .catch(() => null);
}

export const useStickerUsageStore = create<StickerUsageStore>()(
  persist(
    (set) => ({
      counts: {},
      bump: (key) => {
        set((s) => ({ counts: { ...s.counts, [key]: (s.counts[key] ?? 0) + 1 } }));
        void post({ key }); // บันทึกที่เซิร์ฟเวอร์ — พลาดก็ไม่เป็นไร ครั้งหน้าก็นับต่อ
      },
      setCounts: (counts) => set({ counts }),
    }),
    {
      name: "eb-sticker-usage",
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);

/**
 * โหลดลำดับของฉันจากเซิร์ฟเวอร์ (เรียกครั้งเดียวตอนเปิดโมดูล) — ครั้งแรกที่เซิร์ฟเวอร์ยังว่าง
 * ย้ายของเดิมในเครื่องขึ้นไปให้ ลำดับที่เคยใช้จะได้ไม่หาย
 */
export async function syncStickerUsageFromServer(): Promise<void> {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (!res.ok) return;
    const { counts } = (await res.json()) as { counts: Record<string, number> };
    const local = useStickerUsageStore.getState().counts;
    if (Object.keys(counts).length === 0 && Object.keys(local).length > 0) {
      const merged = await post({ merge: local });
      if (merged) useStickerUsageStore.getState().setCounts(merged);
      return;
    }
    useStickerUsageStore.getState().setCounts(counts);
  } catch {
    // ออฟไลน์ — ใช้ของในเครื่องไปก่อน
  }
}

/** Stable sort — items with equal (including zero) usage keep their original/config order. */
export function sortByUsage<T>(items: T[], keyOf: (item: T) => string, counts: Record<string, number>): T[] {
  return items
    .map((item, index) => ({ item, index, count: counts[keyOf(item)] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((x) => x.item);
}
