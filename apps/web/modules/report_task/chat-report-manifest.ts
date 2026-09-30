import { createElement } from "react";
import type { ModuleManifest } from "@/module-registry";

import { CHAT_PAGE_PATH } from "@/modules/chat/constants";
import { CHAT_PERMS } from "@/modules/chat/permissions";
import { ChatNavBadge } from "@/modules/chat/components/chat-nav-badge";
import { CHAT_REPORT_BASE, CHAT_REPORT_CODE, REPORT_FEED_PATH, REPORT_TASK_CODE } from "./constants";
import { REPORT_TASK_PERMS } from "./permissions";
import { ReportActivityNavBadge } from "./components/shared/report-activity-nav-badge";

/**
 * "Chat & Report" — แชท + รายงาน แยกออกจาก "รายงานและงาน" มาเป็นโมดูลหลักของตัวเอง
 * (รายงานและงานเหลือ แดชบอร์ด / งาน / ปฏิทิน / บันทึกกิจกรรม / ตั้งค่า)
 *
 * ไม่มีแถว Module ใน DB ของ code นี้ — เปิดตามโมดูล report_task ของบริษัท (requiresModule)
 * เหมือนตอนเมนูทั้งสองยังอยู่ใต้รายงานและงาน · สิทธิ์ต่อเมนูเหมือนเดิม (chat.access / report_task.report.view)
 * ข้อมูลรายงานยังอยู่ใน store ของ report_task — หน้าใช้ตัวห่อเดียวกัน (app/(shell)/chat-report/layout.tsx)
 */
export const chatReportManifest: ModuleManifest = {
  id: CHAT_REPORT_CODE,
  name: "Chat & Report",
  color: "#16A34A",
  colorBg: "#F0FDF4",
  basePath: CHAT_REPORT_BASE,
  icon: "MessageCircle",
  requiresModule: REPORT_TASK_CODE,
  menus: [
    {
      label: "แชท",
      path: CHAT_PAGE_PATH,
      permission: CHAT_PERMS.access,
      icon: "MessageCircle",
      badge: createElement(ChatNavBadge),
    },
    {
      label: "รายงาน",
      path: REPORT_FEED_PATH,
      permission: REPORT_TASK_PERMS.reportView,
      icon: "MessageSquareText",
      badge: createElement(ReportActivityNavBadge),
    },
  ],
  permissions: [CHAT_PERMS.access, REPORT_TASK_PERMS.reportView],
};
