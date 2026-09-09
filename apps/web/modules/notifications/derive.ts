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
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { NotifCategory } from "@/modules/notifications/types";

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
  if (m.includes("งาน") || m.includes("กำหนดส่ง") || m.includes("ตรวจ") || m.includes("เสร็จสิ้น")) return "task";
  return "general";
}

/** maintenance's own `type` field ผูกกับ category ตรงตัว 1:1 */
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
    default:
      return "general";
  }
}

const CATEGORY_META: Record<NotifCategory, ActionMeta> = {
  report_post: { Icon: FileText, color: "#3B82F6" },
  reply: { Icon: CornerDownRight, color: "#16A34A" },
  mention: { Icon: AtSign, color: "#8B5CF6" },
  reaction: { Icon: Heart, color: "#EC4899" },
  task: { Icon: CheckCircle2, color: "#0D9488" },
  meeting: { Icon: CalendarClock, color: "#6366F1" },
  ticket: { Icon: TriangleAlert, color: "#F59E0B" },
  report_reminder: { Icon: Clock, color: "#F59E0B" },
  work_order: { Icon: ClipboardList, color: "#2196F3" },
  pm: { Icon: CalendarClock, color: "#FF9800" },
  expense: { Icon: ReceiptText, color: "#4CAF50" },
  purchase_order: { Icon: ReceiptText, color: "#4CAF50" },
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
  meeting: "ประชุม",
  ticket: "ตั๋วปัญหา",
  report_reminder: "แจ้งเตือนส่งรายงาน",
  work_order: "ใบงานซ่อมบำรุง",
  pm: "แผนบำรุงรักษา",
  expense: "ค่าใช้จ่าย",
  purchase_order: "ใบสั่งซื้อ",
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
  return null;
}
