import type { Sticker } from "@/modules/report_task/types";

// Default sticker set — editable at runtime via the sticker store.
// "angry" is the flagship: a lead clicks it on a non-compliant task to dock 5 points.
// Note: the missed-deadline dock is NOT a sticker — it's a task status (Task.penalty),
// because it's a deliberate case-by-case call rather than a casual reaction.
export const defaultStickers: Sticker[] = [
  { id: "angry", emoji: "😡", label: "หัวร้อน", points: -5, builtin: true },
  { id: "warning", emoji: "⚠️", label: "เตือนแล้วนะ", points: -2, builtin: true },
  { id: "fire", emoji: "🔥", label: "ด่วนมาก", points: 0, builtin: true },
  { id: "clap", emoji: "👏", label: "ทำได้ดี", points: 2, builtin: true },
  { id: "star", emoji: "⭐", label: "ผลงานเด่น", points: 3, builtin: true },
];
