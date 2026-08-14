import type { CalendarEventType } from "@/modules/report_task/types";
import { chartColors } from "@/modules/report_task/lib/chart-colors";

export const eventTypeColors: Record<CalendarEventType, string> = {
  task: chartColors.blue,
  meeting: chartColors.violet,
  leave: chartColors.pink,
  // Neutral gray rather than a hue of its own — holidays aren't actionable
  // like a task/meeting/leave, so they shouldn't compete for attention on
  // the schedule. The party-popper icon (not color) is what identifies them;
  // see the .ebw-event-holiday opacity rule in globals.css for the rest of
  // the fade — lighter than a normal chip, but not as ghosted as a past one.
  holiday: chartColors.gray,
  // Google's own brand blue — reads as "not ours" at a glance, distinct from
  // the app's chart-blue used for tasks.
  google: "#4285F4",
  // A personal routine day off — its own hue (teal), distinct from both a
  // requested/approved "leave" and a company-declared "holiday", since it's
  // neither: self-picked, quota-tracked, and swappable.
  dayoff: chartColors.teal,
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
