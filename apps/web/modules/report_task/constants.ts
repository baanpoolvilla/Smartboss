/**
 * ค่าคงที่ของโมดูล — แยกไฟล์เพื่อไม่ให้ manifest กับ nav-config import วนกัน
 * (manifest สร้างเมนูจาก navItems ส่วน navItems ต้องรู้ basePath)
 */

/** ต้องตรงกับ Module.code ใน DB — seed ลงทะเบียนไว้แล้วตั้งแต่ต้น */
export const REPORT_TASK_CODE = "report_task";

export const REPORT_TASK_BASE = "/report-task";

/** "แจ้งบัค" ของ user ทั่วไป — โมดูลของตัวเอง แยกจาก REPORT_TASK_BASE */
export const ISSUE_REPORTS_BASE = "/issue-reports";
