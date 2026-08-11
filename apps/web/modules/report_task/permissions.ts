/**
 * Permission codes ของโมดูลรายงานและงาน (report_task)
 *
 * ⚠ อย่าสับสนกับ `lib/permissions.ts` ในโมดูลเดียวกัน — คนละชั้นกัน
 *   - ไฟล์นี้ = สิทธิ์ระดับ "เข้าหน้าไหนได้บ้าง" ของ Smartboss RBAC
 *     บริษัทกำหนดที่ /admin/roles แล้ว shell ใช้ตัดสินว่าโชว์เมนูไหน
 *   - lib/permissions.ts = สิทธิ์ระดับ "แถวนี้ใครแก้ได้" (คนสร้าง / หัวหน้าแผนก / เจ้าของ)
 *     ตัดสินรายเรคคอร์ดตอน runtime ไม่ได้อยู่ในทะเบียนสิทธิ์
 *
 * บันทึกกิจกรรมแยกสิทธิ์ออกมาต่างหาก เพราะเป็นข้อมูลการกระทำของคนทั้งบริษัท
 * ไม่ควรติดมากับสิทธิ์ดูงานตามปกติ
 */
export const REPORT_TASK_PERMS = {
  access: "report_task.access",

  taskView: "report_task.task.view",
  taskManage: "report_task.task.manage",

  calendarView: "report_task.calendar.view",
  calendarManage: "report_task.calendar.manage",

  reportView: "report_task.report.view",
  reportSubmit: "report_task.report.submit",
  reportManage: "report_task.report.manage",

  activityView: "report_task.activity.view",

  /** ศูนย์แจ้งปัญหาระบบ — ต้นทางเพิ่มมาในรอบ "issue desk" */
  issueView: "report_task.issue.view",
  issueManage: "report_task.issue.manage",

  settingManage: "report_task.setting.manage",
} as const;

export const ALL_REPORT_TASK_PERMS: string[] = Object.values(REPORT_TASK_PERMS);

export const REPORT_TASK_PERM_LABELS: Record<string, string> = {
  [REPORT_TASK_PERMS.access]: "เข้าใช้โมดูลรายงานและงาน",
  [REPORT_TASK_PERMS.taskView]: "ดูงานและบอร์ด Kanban",
  [REPORT_TASK_PERMS.taskManage]: "สร้าง/แก้ไข/มอบหมายงาน",
  [REPORT_TASK_PERMS.calendarView]: "ดูปฏิทินทีม",
  [REPORT_TASK_PERMS.calendarManage]: "จัดการวันหยุด/ประชุม/ประเภทการลา",
  [REPORT_TASK_PERMS.reportView]: "ดูรายงานและสรุปผล",
  [REPORT_TASK_PERMS.reportSubmit]: "ส่งรายงานประจำวัน",
  [REPORT_TASK_PERMS.reportManage]: "จัดการหัวข้อรายงานและข้อยกเว้น",
  [REPORT_TASK_PERMS.activityView]: "ดูบันทึกกิจกรรมของทั้งบริษัท",
  [REPORT_TASK_PERMS.issueView]: "แจ้งปัญหาระบบและดูเรื่องของตัวเอง",
  [REPORT_TASK_PERMS.issueManage]: "รับเรื่องและปิดงานในศูนย์แจ้งปัญหา",
  [REPORT_TASK_PERMS.settingManage]: "ตั้งค่าโมดูล",
};
