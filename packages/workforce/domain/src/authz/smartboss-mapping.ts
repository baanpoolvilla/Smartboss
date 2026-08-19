import { SYSTEM_ROLES, type SystemRole } from './roles';

/* ══════════════════════════════════════════════════════════════════
   แปลงสิทธิ์ของ Smartboss → role ของ workforce

   อยู่ใน @workforce/domain (แพ็กเกจล้วน ไม่มี dependency) เพราะทั้ง CLI
   (`pnpm wf:sync` ผ่าน @workforce/db) และเว็บ (server action ตอนสร้าง/แก้ผู้ใช้)
   ต้องตัดสินเหมือนกันเป๊ะ — ถ้าเว็บต้อง import @workforce/db เพื่อใช้ฟังก์ชันนี้
   จะลาก drizzle + pg เข้า bundle ทั้งชุดโดยไม่จำเป็น
   ══════════════════════════════════════════════════════════════════ */

/** สิทธิ์ฝั่ง Smartboss ที่เกี่ยวข้อง (ตรงกับ apps/web/modules/hr/permissions.ts และ modules/admin) */
export const SMARTBOSS_PERMISSION = {
  adminAccess: 'core.admin',
  employeeView: 'hr.employee.view',
  employeeManage: 'hr.employee.manage',
  salaryView: 'hr.salary.view',
  salaryManage: 'hr.salary.manage',
  payrollView: 'hr.payroll.view',
  payrollManage: 'hr.payroll.manage',
  payrollApprove: 'hr.payroll.approve',
  settingManage: 'hr.setting.manage',
} as const;

export interface RoleMappingInput {
  /** role code ของ Smartboss เช่น SUPER_ADMIN, HR_OFFICER */
  roles: readonly string[];
  /** permission code ที่ผู้ใช้มี */
  permissions: readonly string[];
}

/**
 * เลือก role ของ workforce จากสิทธิ์ที่ผู้ใช้มีใน Smartboss
 *
 * กฎแยกหน้าที่ (HANDOFF §4): PAYROLL_PREPARER กับ PAYROLL_APPROVER ต้องไม่ใช่คนเดียวกัน
 * คนที่อนุมัติได้จะได้ APPROVER อย่างเดียว ไม่ได้ PREPARER ติดมาด้วย
 * — บังคับที่ระดับสิทธิ์ ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
 */
export function mapSmartbossRoles(input: RoleMappingInput): SystemRole[] {
  const perms = new Set(input.permissions);
  const roleCodes = new Set(input.roles.map((code) => code.toUpperCase()));
  const granted = new Set<SystemRole>();

  const has = (permission: string): boolean => perms.has(permission);

  // ผู้ดูแลระบบ/ผู้ดูแลบริษัท → ผู้ดูแลองค์กรของ workforce
  if (roleCodes.has('SUPER_ADMIN') || roleCodes.has('ADMIN')) {
    granted.add('TENANT_ADMIN');
  }

  if (roleCodes.has('MANAGER')) granted.add('SUPERVISOR');

  if (has(SMARTBOSS_PERMISSION.employeeManage) || roleCodes.has('HR_OFFICER')) {
    granted.add('HR_OFFICER');
  }

  // ── เงินเดือน: อนุมัติได้ = APPROVER เท่านั้น ห้ามได้ PREPARER ด้วย ──
  if (has(SMARTBOSS_PERMISSION.payrollApprove)) {
    granted.add('PAYROLL_APPROVER');
  } else if (
    has(SMARTBOSS_PERMISSION.payrollManage) ||
    has(SMARTBOSS_PERMISSION.salaryManage)
  ) {
    granted.add('PAYROLL_PREPARER');
  }

  if (has(SMARTBOSS_PERMISSION.settingManage)) {
    granted.add('HR_OFFICER');
    // หน้า /hr/devices ของ Smartboss เปิดให้คนที่มี hr.setting.manage
    // แต่สิทธิ์เครื่องสแกนอยู่ที่ DEVICE_TECHNICIAN — ถ้าไม่ให้ด้วย
    // ปุ่มบนหน้าจอจะกดแล้ว 403 ทุกครั้ง (ลงทะเบียนเครื่อง/ออกโทเคน/ผูกลายนิ้วมือ)
    granted.add('DEVICE_TECHNICIAN');
  }

  // ทุกคนที่เข้าถึงระบบได้ อย่างน้อยต้องเป็นพนักงาน (ดูสลิป/ลงเวลาของตัวเอง)
  granted.add('EMPLOYEE');

  // เรียงตามลำดับใน SYSTEM_ROLES เพื่อให้ผลลัพธ์คงที่ เทียบใน test ได้
  return SYSTEM_ROLES.filter((role) => granted.has(role));
}
