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
 */
interface StickerUsageStore {
  counts: Record<string, number>;
  bump: (key: string) => void;
}

export const useStickerUsageStore = create<StickerUsageStore>()(
  persist(
    (set) => ({
      counts: {},
      bump: (key) =>
        set((s) => ({ counts: { ...s.counts, [key]: (s.counts[key] ?? 0) + 1 } })),
    }),
    {
      name: "eb-sticker-usage",
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);

/** Stable sort — items with equal (including zero) usage keep their original/config order. */
export function sortByUsage<T>(items: T[], keyOf: (item: T) => string, counts: Record<string, number>): T[] {
  return items
    .map((item, index) => ({ item, index, count: counts[keyOf(item)] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((x) => x.item);
}
