/**
 * Permission codes ของโมดูลบุคคล (HR / ลงเวลา / เงินเดือน)
 *
 * โมดูลนี้ถูกแทนที่ด้วยระบบ workforce แล้ว (ดู docs/workforce_integration.md)
 * หน้าจอและตาราง `hr.*` เดิมถูกลบทิ้ง — แต่ **ยังต้องเก็บ permission ชุดนี้ไว้**
 * เพราะเป็นตัวที่บริษัทใช้กำหนดสิทธิ์ที่หน้า /admin/roles แล้วถูกแปลงเป็น role
 * ของ workforce ด้วย mapSmartbossRoles() ตอน sync
 *
 * เงินเดือนแยกสิทธิ์ออกจากข้อมูลพนักงาน — คนที่ดูทะเบียนพนักงานได้ ไม่จำเป็นต้องเห็นเงินเดือน
 */
export const HR_PERMS = {
  access: "hr.access",

  employeeView: "hr.employee.view",
  employeeManage: "hr.employee.manage",

  salaryView: "hr.salary.view",
  salaryManage: "hr.salary.manage",

  payrollView: "hr.payroll.view",
  payrollManage: "hr.payroll.manage",
  payrollApprove: "hr.payroll.approve",

  settingManage: "hr.setting.manage",
} as const;

export const ALL_HR_PERMS: string[] = Object.values(HR_PERMS);

export const HR_PERM_LABELS: Record<string, string> = {
  [HR_PERMS.access]: "เข้าใช้โมดูลบุคคล",
  [HR_PERMS.employeeView]: "ดูทะเบียนพนักงาน",
  [HR_PERMS.employeeManage]: "เพิ่ม/แก้ไข/ลบพนักงาน",
  [HR_PERMS.salaryView]: "ดูฐานเงินเดือน",
  [HR_PERMS.salaryManage]: "ตั้ง/แก้ไขฐานเงินเดือน",
  [HR_PERMS.payrollView]: "ดูรอบจ่ายและสลิปเงินเดือน",
  [HR_PERMS.payrollManage]: "สร้าง/คำนวณรอบจ่าย",
  [HR_PERMS.payrollApprove]: "อนุมัติและปิดรอบจ่าย",
  [HR_PERMS.settingManage]: "ตั้งค่าการคำนวณเงินเดือน",
};
