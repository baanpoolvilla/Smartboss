/**
 * ค่าคงที่ของโมดูล — แยกไฟล์เพื่อไม่ให้ manifest กับ nav-config import วนกัน
 * (manifest สร้างเมนูจาก navItems ส่วน navItems ต้องรู้ basePath)
 */

/** ต้องตรงกับ Module.code ใน DB — seed ลงทะเบียนไว้แล้วตั้งแต่ต้น */
export const REPORT_TASK_CODE = "report_task";

export const REPORT_TASK_BASE = "/report-task";

/** "แจ้งบัค" ของ user ทั่วไป — โมดูลของตัวเอง แยกจาก REPORT_TASK_BASE */
export const ISSUE_REPORTS_BASE = "/issue-reports";

/**
 * "Chat & Report" — แชท + รายงาน แยกออกมาเป็นโมดูลหลักของตัวเอง (chat-report-manifest.ts)
 * เดิมอยู่ที่ /report-task/chat และ /report-task/report-feed — ลิงก์เก่า redirect มาที่นี่ (next.config)
 * ไม่มีแถว Module ใน DB ของ code นี้ — เปิดตามโมดูล report_task ของบริษัท (requiresModule)
 */
export const CHAT_REPORT_CODE = "chat_report";
export const CHAT_REPORT_BASE = "/chat-report";
export const REPORT_FEED_PATH = `${CHAT_REPORT_BASE}/report-feed`;

/**
 * หน้านี้ห่อด้วย ReportTaskScaffold (มี StoreHydrator ซิงก์ store ของ report_task อยู่แล้ว) —
 * /report-task, /chat-report, /issue-reports ใช้ layout เดียวกัน ตัวซิงก์นอกโมดูล
 * (ReportNotificationSync, IssueReportBarButton) ต้องหลบ ไม่งั้นสองตัวเขียน store เดียวกันแข่งกัน
 */
export function usesReportTaskScaffold(pathname: string): boolean {
  return [REPORT_TASK_BASE, CHAT_REPORT_BASE, ISSUE_REPORTS_BASE].some((base) => pathname === base || pathname.startsWith(`${base}/`));
}
