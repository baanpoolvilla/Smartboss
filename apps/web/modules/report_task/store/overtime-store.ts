import { create } from "zustand";
import type { CalendarEvent } from "@/modules/report_task/types";

interface OvertimeStore {
  overtime: CalendarEvent[];
  setOvertime: (overtime: CalendarEvent[]) => void;
}

/** OT ที่อนุมัติครบแล้ว — mirror อ่านอย่างเดียวของ workforce.overtime_requests
 * เหมือน leave-store.ts เป๊ะ (ดู lib/db/workforce-calendar.ts's
 * listOvertimeEvents) Server-synced ผ่าน ServerStoreSync (apiKey "overtime")
 * ใน store-hydrator.tsx */
export const useOvertimeStore = create<OvertimeStore>()((set) => ({
  overtime: [],
  setOvertime: (overtime) => set({ overtime }),
}));
