import {
  CalendarDays,
  KanbanSquare,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { REPORT_TASK_BASE } from "../constants";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * ชื่อไอคอนเป็นสตริงสำหรับ manifest — ต้องมีคู่กับ icon
   * manifest ข้ามเขต server→client จึงส่ง component ไปไม่ได้ ต้องส่งชื่อแล้วให้
   * lib/icons.ts แปลงกลับ (ชื่อต้องลงทะเบียนที่นั่นด้วย ไม่งั้นได้ไอคอน fallback)
   */
  iconName: string;
  /** Render as a plain link — never show the active highlight (module has its own sub-nav). */
  plain?: boolean;
  /** Only shown to a department head/owner — the page itself shows everyone's performance data. */
  managerOnly?: boolean;
}

/*
 * เดิมอยู่ที่ components/layout/nav-config.ts คู่กับ sidebar ของ workspace
 * ย้ายมา lib/ เพราะ shell กับ sidebar เป็นของ Smartboss แล้ว เหลือแค่ข้อมูลเมนู
 *
 * ทุก href นำหน้าด้วย basePath ของโมดูล ("/report-task") — ตอนเป็นแอปเดี่ยว
 * มันอยู่ที่ราก แต่ตอนนี้เป็นโมดูลหนึ่งใน Smartboss
 * manifest.ts อ่านรายการนี้ไปสร้างเมนูของ shell จะได้ไม่ต้องดูแลสองที่
 */
export const navItems: NavItem[] = [
  { href: REPORT_TASK_BASE, label: "แดชบอร์ด", icon: LayoutDashboard, iconName: "LayoutDashboard" },
  { href: `${REPORT_TASK_BASE}/tasks`, label: "งาน / Kanban", icon: KanbanSquare, iconName: "KanbanSquare" },
  { href: `${REPORT_TASK_BASE}/calendar`, label: "ปฏิทิน", icon: CalendarDays, iconName: "CalendarDays" },
  { href: `${REPORT_TASK_BASE}/report-feed`, label: "รายงาน", icon: MessageSquareText, iconName: "MessageSquareText" },
  // "แจ้งปัญหาระบบ" dropped from the main menu entirely — filing an issue is
  // only ever the 🐛 button anywhere in the app now (IssueReportBarButton),
  // not a page employees navigate to ("แจ้งปัญหาให้แยกเป็นข้างนอกเมนูหลัก
  // เลย"). The route itself still exists (reached from the button's "ดูเรื่อง
  // ที่แจ้งไว้" link) — it just isn't listed here, so manifest.ts never turns
  // it into a sidebar/bottom-nav entry.
  {
    href: `${REPORT_TASK_BASE}/activity-log`,
    label: "บันทึกกิจกรรม",
    icon: ScrollText,
    iconName: "ScrollText",
    managerOnly: true,
  },
  // เห็นได้ทุกคน — ตัวหน้าเองซ่อนส่วนที่เป็นของทั้งบริษัทจากคนที่ไม่ใช่หัวหน้า
  { href: `${REPORT_TASK_BASE}/settings`, label: "ตั้งค่า", icon: Settings, iconName: "Settings" },
];
