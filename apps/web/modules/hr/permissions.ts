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

  /**
   * อนุมัติ/ไม่อนุมัติใบลาและวันหยุด + ได้แจ้งเตือนคำขอ (ผู้ใช้ 8/11/2569 "ทำไม IT กดอนุมัติได้ ต้อง HR/CEO")
   * เดิมใครได้บทบาทอนุมัติลาในระบบบุคคล (จาก ตั้งค่าบุคคล/จัดการพนักงาน/จัดการคนงาน/หัวหน้างาน) ก็อนุมัติได้หมด
   * ตอนนี้ต้องติ๊กสิทธิ์นี้ด้วย — migration ให้ทุกบทบาทที่อนุมัติได้อยู่แล้ว แต่ละบริษัทเอาออกเองที่ หลังบ้าน › บทบาท
   */
  leaveApprove: "hr.leave.approve",
} as const;

export const ALL_HR_PERMS: string[] = Object.values(HR_PERMS);

export const HR_PERM_LABELS: Record<string, string> = {
  [HR_PERMS.access]: "เข้าใช้โมดูลบุคคล",
  [HR_PERMS.employeeView]: "ดูทะเบียนพนักงาน",
  [HR_PERMS.employeeManage]: "เพิ่ม/แก้ไข/ลบพนักงาน",
  // ไม่ใช้ตัดสินแล้ว — ผู้ใช้กำหนด 22/10/2569 ให้เห็น/แก้เงินเดือนได้เฉพาะ CEO + คนที่ CEO เลือก (modules/salary/lib/access.ts)
  [HR_PERMS.salaryView]: "ดูฐานเงินเดือน (ไม่ใช้แล้ว — CEO เลือกคนที่ เงินเดือน › ตั้งค่า)",
  [HR_PERMS.salaryManage]: "ตั้ง/แก้ไขฐานเงินเดือน (ไม่ใช้แล้ว — CEO เลือกคนที่ เงินเดือน › ตั้งค่า)",
  [HR_PERMS.payrollView]: "ดูรอบจ่ายและสลิปเงินเดือน",
  [HR_PERMS.payrollManage]: "สร้าง/คำนวณรอบจ่าย",
  [HR_PERMS.payrollApprove]: "อนุมัติและปิดรอบจ่าย",
  [HR_PERMS.settingManage]: "ตั้งค่าการคำนวณเงินเดือน",
  [HR_PERMS.leaveApprove]: "อนุมัติใบลา/วันหยุด (ได้แจ้งเตือนคำขอลา)",
};
