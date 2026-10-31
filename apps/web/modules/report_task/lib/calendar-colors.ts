import type { CalendarEventType } from "@/modules/report_task/types";
import { chartColors } from "@/modules/report_task/lib/chart-colors";

export const eventTypeColors: Record<CalendarEventType, string> = {
  // task/meeting/todo get their own standalone hex here (not chartColors.
  // blue/violet/amber, which also drive unrelated department/chart colors
  // elsewhere) — punchier versions asked for explicitly ("ปรับสี... ให้
  // ชัดเจนมากกว่านี้"), chartColors.violet in particular read as a dark,
  // muted navy at dot size rather than a clearly "purple" meeting marker.
  //
  // งาน/ประชุม/สิ่งที่ต้องทำ ต้องหลบสีประเภทวันหยุด/ลา (lib/leave-type-hue.ts) ที่วางทับ
  // ปฏิทินเดียวกัน — สีลาห้ามเปลี่ยน ต้องตรงกับปฏิทินทีมใน /hr ⇒ ฝั่งงานเป็นคนหลบ:
  // ลาใช้ hue 0/18/38/112/150/175/280 (Holiday ย้ายจาก 215 เป็นเขียว 112 เมื่อ 31/10/2569) · OT ฟ้า 205
  // งานจึงใช้ คราม (~243) ชมพู (~330) เขียวมะนาว (~85)
  // (เดิมน้ำเงิน/ม่วง/เหลืองอำพัน ชนกับ Holiday/ลาไม่รับค่าจ้าง/ลาพักร้อนพอดี)
  task: "#4f46e5",
  meeting: "#db2777",
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
  // เขียวมะนาว — ไม่ใช่เหลืองอำพันแล้ว (ชนกับลาพักร้อน/Work From Home) ดูหมายเหตุที่ task
  todo: "#65a30d",
  // ฟ้า (hue 205) ตรงกับแถบ OT ในปฏิทินทีม /hr — เดิมส้มดูคล้ายลาพักร้อนจนงง (ผู้ใช้ 31/10/2569)
  ot: "#1f8fd1",
};

export const eventTypeLabels: Record<CalendarEventType, string> = {
  task: "งาน",
  meeting: "ประชุม",
  leave: "ลา",
  holiday: "วันหยุดนักขัตฤกษ์",
  google: "ปฏิทินภายนอก",
  dayoff: "วันหยุดประจำ",
  todo: "สิ่งที่ต้องทำ",
  ot: "OT",
};

// Leave-type labels/colors/icons are configurable at runtime — see leave-type-store.
