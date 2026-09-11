import type { CalendarEventType } from "@/modules/report_task/types";
import { chartColors } from "@/modules/report_task/lib/chart-colors";

export const eventTypeColors: Record<CalendarEventType, string> = {
  // task/meeting/todo get their own standalone hex here (not chartColors.
  // blue/violet/amber, which also drive unrelated department/chart colors
  // elsewhere) — punchier versions asked for explicitly ("ปรับสี... ให้
  // ชัดเจนมากกว่านี้"), chartColors.violet in particular read as a dark,
  // muted navy at dot size rather than a clearly "purple" meeting marker.
  task: "#2563eb",
  meeting: "#7c3aed",
  // Neutral gray — "ลา" covers several sub-types each already colored on
  // their own chip (see leave-icons.ts's presets), so the umbrella category
  // itself stays out of the way rather than competing with them.
  leave: chartColors.gray,
  // Blue — a country/company holiday, distinct from "ลา" (gray) and
  // "วันหยุดประจำ" (green).
  holiday: chartColors.blue,
  // Google's own brand blue — reads as "not ours" at a glance, distinct from
  // the app's chart-blue used for tasks.
  google: "#4285F4",
  // A personal routine day off / HR day-off entitlement — green, distinct
  // from both a requested/approved "leave" (blue) and a company-declared
  // "holiday" (violet), since it's neither: pre-approved and recurring.
  dayoff: chartColors.green,
  // Its own hue (amber) — distinct from every other type so a checked-off
  // to-do reads as "done" the same amber-to-gray way a checklist item does.
  todo: chartColors.amber,
};

export const eventTypeLabels: Record<CalendarEventType, string> = {
  task: "งาน",
  meeting: "ประชุม",
  leave: "ลา",
  holiday: "วันหยุด",
  google: "ปฏิทินภายนอก",
  dayoff: "วันหยุดประจำ",
  todo: "สิ่งที่ต้องทำ",
};

// Leave-type labels/colors/icons are configurable at runtime — see leave-type-store.
