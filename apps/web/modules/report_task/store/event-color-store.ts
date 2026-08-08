import { create } from "zustand";
import { eventTypeColors } from "@/modules/report_task/lib/calendar-colors";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import type { CalendarEventType } from "@/modules/report_task/types";

// Preset palette users can pick from for each event type.
export const colorPalette: { name: string; value: string }[] = [
  { name: "ฟ้า", value: chartColors.blue },
  { name: "ม่วง", value: chartColors.violet },
  { name: "ชมพู", value: chartColors.pink },
  { name: "เขียว", value: chartColors.green },
  { name: "ส้ม", value: chartColors.orange },
  { name: "เหลือง", value: chartColors.amber },
  { name: "แดง", value: chartColors.red },
  { name: "เทา", value: chartColors.gray },
];

interface EventColorStore {
  colors: Record<CalendarEventType, string>;
  setColor: (type: CalendarEventType, color: string) => void;
}

export const useEventColorStore = create<EventColorStore>((set) => ({
  colors: { ...eventTypeColors },
  setColor: (type, color) => set((s) => ({ colors: { ...s.colors, [type]: color } })),
}));
