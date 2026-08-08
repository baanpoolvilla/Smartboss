/**
 * Permission codes ของหลังบ้าน (/admin) — เป็นสิทธิ์ระดับ core ไม่ผูกกับโมดูลธุรกิจ
 * SUPER_ADMIN ข้ามทุกข้อ (ดู hasPermission ใน @smartboss/auth)
 */
export const ADMIN_PERMS = {
  access: "core.admin",

  userView: "core.user.view",
  userManage: "core.user.manage",

  roleView: "core.role.view",
  roleManage: "core.role.manage",

  moduleManage: "core.module.manage",
  orgManage: "core.org.manage",
  auditView: "core.audit.view",

  /** ดูสรุปผลงานรายคนข้ามทุกโมดูล — สำหรับผู้บริหาร/หัวหน้า */
  performanceView: "core.performance.view",

  /** ตั้งเกณฑ์คะแนนของบริษัท (คะแนนตั้งต้น อัตราหัก เกณฑ์เกรด) */
  performanceSettingManage: "core.performance.setting.manage",
} as const;

export const ALL_ADMIN_PERMS: string[] = Object.values(ADMIN_PERMS);

/** คำอธิบายไทยของแต่ละสิทธิ์ — ใช้บนหน้า "บทบาท & สิทธิ์" */
export const ADMIN_PERM_LABELS: Record<string, string> = {
  [ADMIN_PERMS.access]: "เข้าหน้าหลังบ้าน",
  [ADMIN_PERMS.userView]: "ดูรายชื่อผู้ใช้งาน",
  [ADMIN_PERMS.userManage]: "เพิ่ม/แก้ไข/ลบผู้ใช้งาน",
  [ADMIN_PERMS.roleView]: "ดูบทบาทและสิทธิ์",
  [ADMIN_PERMS.roleManage]: "สร้าง/แก้ไขบทบาทและสิทธิ์",
  [ADMIN_PERMS.moduleManage]: "เปิด/ปิดโมดูลของบริษัท",
  [ADMIN_PERMS.orgManage]: "แก้ไขข้อมูลบริษัท",
  [ADMIN_PERMS.auditView]: "ดูประวัติการใช้งาน (audit log)",
  [ADMIN_PERMS.performanceView]: "ดูสรุปผลงานรายคนของทั้งบริษัท",
  [ADMIN_PERMS.performanceSettingManage]: "ตั้งเกณฑ์คะแนนผลงานของบริษัท",
};
