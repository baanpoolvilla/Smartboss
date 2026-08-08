import { create } from "zustand";
import { defaultStickers } from "@/modules/report_task/data/stickers";
import type { Sticker } from "@/modules/report_task/types";

interface StickerStore {
  stickers: Sticker[];
  addSticker: (sticker: Omit<Sticker, "id">) => void;
  updateSticker: (id: string, patch: Partial<Omit<Sticker, "id">>) => void;
  removeSticker: (id: string) => void;
  /** Replaces the whole list in one commit — used by the sticker manager dialog's Save button, which stages edits locally until then. */
  setStickers: (stickers: Sticker[]) => void;
}

// Server-synced via ServerStoreSync (apiKey "stickers") in
// store-hydrator.tsx — shared org-wide config, not per-browser.
export const useStickerStore = create<StickerStore>()((set) => ({
  stickers: defaultStickers,
  addSticker: (sticker) =>
    set((s) => ({
      stickers: [...s.stickers, { ...sticker, id: `stk-${crypto.randomUUID()}` }],
    })),
  updateSticker: (id, patch) =>
    set((s) => ({
      stickers: s.stickers.map((st) => (st.id === id ? { ...st, ...patch } : st)),
    })),
  removeSticker: (id) =>
    set((s) => ({
      stickers: s.stickers.filter((st) => st.id !== id),
    })),
  setStickers: (stickers) => set({ stickers }),
}));
