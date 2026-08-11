import type { ModuleManifest, ModuleMenuItem } from "@/module-registry";

import { REPORT_TASK_BASE, REPORT_TASK_CODE } from "./constants";
import { navItems } from "./lib/nav-config";
import { ALL_REPORT_TASK_PERMS, REPORT_TASK_PERMS } from "./permissions";

/**
 * โมดูลรายงานและงาน — พอร์ตมาจากแอป easyboss-workspace ที่เคยรันเดี่ยว ๆ
 *
 * สีมาจาก --mod-report ใน packages/ui/tokens.css (Slate #64748B) ซึ่งจองไว้
 * ตั้งแต่ Phase 1 พร้อมกับการ์ด "เร็ว ๆ นี้" ในหน้า launcher
 *
 * เมนูสร้างจาก navItems ของโมดูลโดยตรง เพื่อไม่ให้รายการเมนูแตกเป็นสองที่
 * (ค้นหาด่วน ⌘K ก็อ่านรายการเดียวกันนี้)
 */

/** สิทธิ์ที่ต้องมีถึงจะเห็นเมนูแต่ละอัน — เรียงตาม href ของ navItems */
const MENU_PERMISSION: Record<string, string> = {
  [REPORT_TASK_BASE]: REPORT_TASK_PERMS.access,
  [`${REPORT_TASK_BASE}/tasks`]: REPORT_TASK_PERMS.taskView,
  [`${REPORT_TASK_BASE}/calendar`]: REPORT_TASK_PERMS.calendarView,
  [`${REPORT_TASK_BASE}/report-feed`]: REPORT_TASK_PERMS.reportView,
  [`${REPORT_TASK_BASE}/issue-reports`]: REPORT_TASK_PERMS.issueView,
  [`${REPORT_TASK_BASE}/activity-log`]: REPORT_TASK_PERMS.activityView,
  [`${REPORT_TASK_BASE}/settings`]: REPORT_TASK_PERMS.settingManage,
};

const menus: ModuleMenuItem[] = navItems.map((item) => ({
  label: item.label,
  path: item.href,
  permission: MENU_PERMISSION[item.href] ?? REPORT_TASK_PERMS.access,
  icon: item.iconName,
}));

export const reportTaskManifest: ModuleManifest = {
  id: REPORT_TASK_CODE,
  name: "รายงานและงาน",
  color: "#64748B",
  colorBg: "#F4F6F9",
  basePath: REPORT_TASK_BASE,
  icon: "ClipboardList",
  // เมนู "สรุปผล" (/reports) ถูกตัดออกเมื่อ 2026-08-08 เพราะต้นทางลบหน้านั้นทิ้ง
  // แล้วย้ายกราฟทั้งหมดไปอยู่บนแดชบอร์ดแทน (commit "Redesign dashboard,
  // remove legacy reports pages") — ถ้าเหลือไว้จะเป็นเมนูที่กดแล้ว 404
  menus,
  permissions: ALL_REPORT_TASK_PERMS,
};
