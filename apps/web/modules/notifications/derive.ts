import {
  AtSign,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  CornerDownRight,
  FileText,
  Heart,
  ReceiptText,
  RotateCcw,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { NotifCategory, NotifModule } from "@/modules/notifications/types";

export type ActionMeta = { Icon: LucideIcon; color: string };

/** แจ้งเตือน "โพสต์ใหม่ในห้อง" — ปกติดูจาก kind "room_post" แต่ของเก่าที่สร้าง
 * ก่อนมี field นี้ยังไม่มี kind จึงเดาเพิ่มจากรูปแบบข้อความ (`โพสต์ใหม่ใน "…"`)
 * เพื่อให้คนทั่วไปไม่เห็นแจ้งเตือนโพสต์ข้ามแผนกที่ค้างอยู่ในระบบ */
export function isRoomPost(n: AppNotification): boolean {
  return n.kind === "room_post" || /โพสต์ใหม่ใน\s*"/.test(n.message);
}

/** เดาไอคอน/สีของแบดจ์บนรูปโปรไฟล์ จาก kind + รูปแบบข้อความ (ฝั่ง report_task
 * เท่านั้น) — แยกจาก reportCategoryFor เพราะสองอย่างนี้แม่นยำคนละระดับ:
 * ไอคอนนี้ต้องแยก "เพิ่มคุณเข้าห้อง" กับ "แท็ก" ให้คนละหน้าตา ในขณะที่ตัวกรอง
 * ตามประเภทบนหน้าเต็มจัดสองอย่างนี้รวมกลุ่มเดียวกันได้ (ทั้งคู่ = "เกี่ยวกับฉัน") */
export function actionMetaFor(n: AppNotification): ActionMeta {
  if (n.kind === "room_post") return { Icon: FileText, color: "#3B82F6" };
  const m = n.message;
  if (m.includes("ยังไม่ส่งรายงาน")) return { Icon: Clock, color: "#F59E0B" };
  if (m.includes("ตั๋ว") || m.includes("แจ้งปัญหา")) return { Icon: TriangleAlert, color: "#F59E0B" };
  if (m.includes("ประชุม")) return { Icon: CalendarClock, color: "#6366F1" };
  if (m.includes("เพิ่มคุณเข้าห้อง")) return { Icon: UserPlus, color: "#16A34A" };
  if (m.includes("แท็ก")) return { Icon: AtSign, color: "#8B5CF6" };
  // "ทำเครื่องหมาย" alone is ambiguous — task-store.ts uses the exact same
  // verb for "ทำเครื่องหมาย ... ว่าเสร็จสิ้น" (marking a TASK complete), so
  // checking the word alone caught that message here first and showed it
  // as a pink reaction heart instead of a task checkmark ("มันจะรู้ได้ไง
  // แจ้งเตือนอันนี้ใช้อะไร" — the icon didn't match what the notification
  // was actually about). Only report-feed-store's emoji-reaction messages
  // say "ให้โพสต์ของคุณ" / "ให้ความคิดเห็นของคุณ" — require that phrasing so
  // a task-completion notice falls through to the "เสร็จสิ้น" task rule below.
  if (m.includes("ทำเครื่องหมาย") && (m.includes("ให้โพสต์") || m.includes("ให้ความคิดเห็น")))
    return { Icon: Heart, color: "#EC4899" };
  if (m.includes("ตอบกลับ")) return { Icon: CornerDownRight, color: "#16A34A" };
  // rejectReview()'s "ตรวจงาน...แล้วไม่ผ่าน" also contains "งาน"/"ตรวจ", so it
  // has to be checked before the generic task rule below or it'd get the
  // same green checkmark as a normal completed/approved task ("ต้องแยกสิ
  // เวลาโดนไม่ผ่าน") — a rejection needs to read as "sent back", not "done".
  if (m.includes("ตรวจงาน") && m.includes("ไม่ผ่าน")) return { Icon: RotateCcw, color: "#DC2626" };
  if (m.includes("งาน") || m.includes("กำหนดส่ง") || m.includes("ตรวจ") || m.includes("เสร็จสิ้น"))
    return { Icon: CheckCircle2, color: "#0D9488" };
  return { Icon: Bell, color: "#6B7280" };
}

/** เดา category ของแจ้งเตือนฝั่ง report_task ไว้ใช้เป็นตัวกรอง "ตามประเภท"
 * บนหน้าเต็ม — ใช้กฎเดาแบบเดียวกับ actionMetaFor แต่จัดกลุ่มหยาบกว่า (เช่น
 * "แท็ก" กับ "เพิ่มคุณเข้าห้อง" ไอคอนคนละแบบแต่จัดเป็นตัวกรอง "mention"
 * เดียวกัน เพราะทั้งคู่คือ "มีคนพาดพิงถึงฉัน") */
export function reportCategoryFor(n: AppNotification): NotifCategory {
  if (isRoomPost(n)) return "report_post";
  const m = n.message;
  if (m.includes("ยังไม่ส่งรายงาน")) return "report_reminder";
  if (m.includes("ตั๋ว") || m.includes("แจ้งปัญหา")) return "ticket";
  if (m.includes("ประชุม")) return "meeting";
  if (m.includes("เพิ่มคุณเข้าห้อง") || m.includes("แท็ก")) return "mention";
  // Same ambiguity as actionMetaFor above — keep both in sync.
  if (m.includes("ทำเครื่องหมาย") && (m.includes("ให้โพสต์") || m.includes("ให้ความคิดเห็น")))
    return "reaction";
  if (m.includes("ตอบกลับ")) return "reply";
  // Same reasoning as actionMetaFor — must come before the generic task rule.
  if (m.includes("ตรวจงาน") && m.includes("ไม่ผ่าน")) return "task_rejected";
  if (m.includes("งาน") || m.includes("กำหนดส่ง") || m.includes("ตรวจ") || m.includes("เสร็จสิ้น")) return "task";
  return "general";
}

/** ผูกกับ category ตรงตัว 1:1 จาก `type` field ที่เก็บใน core.notifications —
 * ชื่อฟังก์ชันเหลือไว้ตามเดิม (มาจากยุคที่มีแต่ maintenance เขียนลงตารางนี้)
 * แต่ตารางนี้ generic จริง ๆ ไม่ได้ผูกกับ maintenance เท่านั้น — HR ก็เขียน
 * "hr_leave_submitted"/"hr_attendance_correction_submitted" ลงมาด้วย (ดู
 * apps/web/modules/hr/lib/hr-notify.ts) */
export function maintenanceCategoryFor(type: string): NotifCategory {
  switch (type) {
    case "work_order":
      return "work_order";
    case "pm":
      return "pm";
    case "expense":
      return "expense";
    case "purchase_order":
      return "purchase_order";
    case "hr_leave_submitted":
      return "hr_leave";
    case "hr_attendance_correction_submitted":
      return "hr_attendance";
    case "issue_ticket_new":
    case "issue_ticket_reply_reporter":
      return "ticket";
    default:
      return "general";
  }
}

/** โมดูลที่ category นี้เป็นของจริง — ใช้แยก badge ต่อ tile/เมนู (HR กับ
 * maintenance เขียนแถวลง core.notifications ตารางเดียวกันจริง แต่เป็นคน
 * ละโมดูลกันในสายตาผู้ใช้ ต้องแยกว่า category ไหนควรขึ้นเลขที่ tile ไหน)
 * เรียกเฉพาะกับ category ที่มาจาก maintenanceCategoryFor(n.type) เท่านั้น
 * (แถวจาก core.notifications) — ฝั่ง report_task (reportCategoryFor) รู้ตัว
 * module ของตัวเองอยู่แล้วโดยไม่ต้องผ่านฟังก์ชันนี้ */
export function moduleForCategory(cat: NotifCategory): NotifModule {
  if (cat === "hr_leave" || cat === "hr_attendance") return "hr";
  if (cat === "ticket") return "report";
  return "maintenance";
}

/** สีประจำโมดูล (ตัวเดียวกับ tile หน้าแรก/แถบโมดูล — ดู packages/ui/tokens.css)
 * ใช้แต้มแถบสีข้างซ้ายของแต่ละแจ้งเตือนในกระดิ่ง ให้กวาดตาแล้วรู้ทันทีว่า
 * มาจากระบบไหนโดยไม่ต้องอ่านข้อความ ("อยากให้แจ้งเตือนมีแท็บ...แสดงสีบอกว่า
 * มาจาก module ไหน") ไอคอน/สีต่อ category ที่มีอยู่แล้ว (CATEGORY_META) บอก
 * "เรื่องอะไร" ภายในโมดูลนั้นอีกที — แถบสีนี้คือชั้นที่หยาบกว่า บอกแค่ "จาก
 * ระบบไหน" เท่านั้น */
function moduleColorVar(mod: NotifModule): string {
  switch (mod) {
    case "hr":
      return "var(--mod-hr)";
    case "maintenance":
      return "var(--mod-maintenance)";
    case "report":
    default:
      return "var(--mod-report)";
  }
}

const MODULE_LABEL: Record<NotifModule, string> = {
  report: "รายงานและงาน",
  maintenance: "แจ้งซ่อมบำรุง",
  hr: "ระบบบุคคล",
};

/** "แจ้งบัค" ไม่ได้อยู่ใน NotifModule ของตัวเองเลย (ticket category ก็แค่
 * moduleForCategory ไปลง "report" เพราะ route จริงอยู่ใต้ /report-task/
 * issue-reports) แต่มีไอคอน/สีเป็นของตัวเองชัดเจนอยู่แล้วในหน้าแรก (ไอคอน
 * แมลงสีแดง #dc2626 — ดู admin/issue-report-manifest.ts) แถบสีในกระดิ่งควร
 * ใช้สีนั้นแทนสีเทาของ "รายงานและงาน" เฉยๆ ไม่งั้นมองแวบเดียวจะดูเหมือนเป็น
 * งาน/รายงานธรรมดา ทั้งที่จริงคือแจ้งบัค ("แจ้งเตือนสีนี้สิ" ชี้ไปที่ tile
 * สีแดงของแจ้งบัคตรงๆ) */
const ISSUE_TICKET_COLOR = "#dc2626";

export function stripeColorFor(category: NotifCategory, mod: NotifModule): string {
  if (category === "ticket") return ISSUE_TICKET_COLOR;
  return moduleColorVar(mod);
}

export function stripeLabelFor(category: NotifCategory, mod: NotifModule): string {
  if (category === "ticket") return "แจ้งบัค";
  return MODULE_LABEL[mod] ?? mod;
}

const CATEGORY_META: Record<NotifCategory, ActionMeta> = {
  report_post: { Icon: FileText, color: "#3B82F6" },
  reply: { Icon: CornerDownRight, color: "#16A34A" },
  mention: { Icon: AtSign, color: "#8B5CF6" },
  reaction: { Icon: Heart, color: "#EC4899" },
  task: { Icon: CheckCircle2, color: "#0D9488" },
  task_rejected: { Icon: RotateCcw, color: "#DC2626" },
  meeting: { Icon: CalendarClock, color: "#6366F1" },
  ticket: { Icon: TriangleAlert, color: "#F59E0B" },
  report_reminder: { Icon: Clock, color: "#F59E0B" },
  work_order: { Icon: ClipboardList, color: "#2196F3" },
  pm: { Icon: CalendarClock, color: "#FF9800" },
  expense: { Icon: ReceiptText, color: "#4CAF50" },
  purchase_order: { Icon: ReceiptText, color: "#4CAF50" },
  hr_leave: { Icon: CalendarClock, color: "#8B5CF6" },
  hr_attendance: { Icon: Clock, color: "#F59E0B" },
  general: { Icon: Bell, color: "#6B7280" },
};

/** ไอคอน/สีตาม category — ใช้กับรายการฝั่ง maintenance (ไม่มีข้อความให้เดา
 * ละเอียดแบบ actionMetaFor เพราะไม่มี avatar คนแนบมาด้วย) และใช้เป็น fallback
 * ทั่วไปเวลาต้องแสดงไอคอนแทนหมวดล้วนๆ (เช่น ป้ายตัวกรองบนหน้าเต็ม) */
export function metaForCategory(cat: NotifCategory): ActionMeta {
  return CATEGORY_META[cat] ?? CATEGORY_META.general;
}

const CATEGORY_LABEL: Record<NotifCategory, string> = {
  report_post: "โพสต์ใหม่ในห้อง",
  reply: "ตอบกลับ",
  mention: "แท็ก/เชิญเข้าห้อง",
  reaction: "รีแอ็กชัน",
  task: "งาน",
  task_rejected: "ตรวจแล้วไม่ผ่าน",
  meeting: "ประชุม",
  ticket: "ตั๋วปัญหา",
  report_reminder: "แจ้งเตือนส่งรายงาน",
  work_order: "ใบงานซ่อมบำรุง",
  pm: "แผนบำรุงรักษา",
  expense: "ค่าใช้จ่าย",
  purchase_order: "ใบสั่งซื้อ",
  hr_leave: "คำขอลา",
  hr_attendance: "แก้ไขเวลาเข้า-ออกงาน",
  general: "ทั่วไป",
};

export function labelForCategory(cat: NotifCategory): string {
  return CATEGORY_LABEL[cat] ?? cat;
}

/** เดิม hrefFor() ใน app/(shell)/notifications/page.tsx — ย้ายมาไว้ตรงกลาง
 * ให้ทั้ง server component เดิมและตัวรวมแจ้งเตือนฝั่ง client เรียกใช้ร่วมกัน */
export function maintenanceHrefFor(type: string, referenceId: string | null): string | null {
  if (type === "work_order" && referenceId) return `/maintenance/work-orders/${referenceId}`;
  if (type === "purchase_order" && referenceId) return `/maintenance/purchase-orders/${referenceId}`;
  if (type === "pm") return "/maintenance/pm";
  if (type === "expense") return "/maintenance/expenses";
  // HR ไม่มีหน้ารายละเอียดต่อคำขอแยกให้ลิงก์ตรง (และคำขอลาหลายวันในครั้ง
  // เดียวก็กลายเป็นหลาย request id แยกกันอยู่แล้ว — ดู hr-notify.ts) พาไปหน้า
  // รายการที่อนุมัติได้เลยแทน
  if (type === "hr_leave_submitted") return "/hr/leave";
  if (type === "hr_attendance_correction_submitted") return "/hr/attendance/corrections";
  // "issue_ticket_new" ไปทีมหลังบ้าน (Super Admin) เท่านั้น — referenceId
  // เก็บเป็น "orgId:ticketId" (ดู issue-notify.ts) เพราะคอนโซลข้ามบริษัทต้อง
  // รู้ทั้งสองอย่างถึงจะลิงก์ตรงตั๋วได้ ส่วน "..._reporter" กลับไปหน้าของผู้
  // แจ้งเอง ซึ่ง org มาจาก session อยู่แล้วไม่ต้องมีใน referenceId
  if (type === "issue_ticket_new" && referenceId?.includes(":")) {
    const [orgId, ticketId] = referenceId.split(":");
    return `/admin/issue-reports/${orgId}/${ticketId}`;
  }
  if (type === "issue_ticket_reply_reporter" && referenceId) return `/report-task/issue-reports/${referenceId}`;
  return null;
}
