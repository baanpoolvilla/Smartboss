import type { Permission } from './permissions';

/**
 * Role ตั้งต้นตาม spec §5
 *
 * เป็นเพียง "ค่าเริ่มต้นที่ seed ให้" — tenant แก้ไข/สร้าง role เองได้
 * ระบบไม่เคยตัดสินใจจากชื่อ role (ADR-0006)
 */
export const SYSTEM_ROLES = [
  'EMPLOYEE',
  'SUPERVISOR',
  'HR_OFFICER',
  'PAYROLL_PREPARER',
  'PAYROLL_APPROVER',
  'FINANCE_OFFICER',
  'DEVICE_TECHNICIAN',
  'AUDITOR',
  'TENANT_ADMIN',
  'SUPPORT_OPERATOR',
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const SYSTEM_ROLE_PERMISSIONS: Readonly<Record<SystemRole, readonly Permission[]>> = {
  EMPLOYEE: [
    'workforce.attendance.read.self',
    'workforce.attendance.correct.request',
    'workforce.leave.request',
    'workforce.overtime.request',
    'workforce.payslip.read.self',
  ],

  SUPERVISOR: [
    'workforce.people.read',
    'workforce.attendance.read.self',
    'workforce.attendance.read.team',
    'workforce.attendance.correct.request',
    'workforce.attendance.correct.approve',
    'workforce.attendance.evidence.read',
    'workforce.scheduling.read',
    'workforce.leave.request',
    'workforce.leave.approve',
    'workforce.overtime.request',
    'workforce.overtime.approve',
    'workforce.timesheet.review',
    'workforce.payslip.read.self',
  ],

  HR_OFFICER: [
    'workforce.people.read',
    'workforce.people.manage',
    'workforce.scheduling.read',
    'workforce.scheduling.manage',
    'workforce.scheduling.publish',
    'workforce.attendance.read.all',
    'workforce.attendance.correct.approve',
    'workforce.attendance.evidence.read',
    'workforce.leave.manage',
    'workforce.leave.approve',
    'workforce.overtime.manage',
    'workforce.overtime.approve',
    'workforce.timesheet.review',
    'workforce.timesheet.close',
    // spec §5 มอบหมวด timesheet ทั้งหมดให้ HR Officer; การกันการใช้อำนาจเกินขอบเขต
    // มาจากเหตุผลบังคับ + audit (ADR-0009) ไม่ใช่จากการไม่มีใครถือสิทธิ์นี้เลย
    'workforce.timesheet.reopen',
  ],

  // เตรียม payroll ได้ แต่อนุมัติเองไม่ได้ (maker-checker, spec §10.2)
  PAYROLL_PREPARER: [
    'workforce.people.read',
    'workforce.attendance.read.all',
    'workforce.payroll.read',
    'workforce.payroll.prepare',
    'workforce.payroll.calculate',
  ],

  // อนุมัติ/ล็อกได้ แต่แก้ input ไม่ได้ (spec §5)
  PAYROLL_APPROVER: [
    'workforce.people.read',
    'workforce.payroll.read',
    'workforce.payroll.approve',
    'workforce.payroll.lock',
    'workforce.payslip.read.all',
  ],

  FINANCE_OFFICER: [
    'workforce.payroll.read',
    'workforce.payroll.mark-paid',
    'workforce.payroll.export',
  ],

  // เห็นเครื่องและ enrollment แต่ไม่เห็นเงินเดือน (spec §5)
  DEVICE_TECHNICIAN: [
    'workforce.devices.read',
    'workforce.devices.manage',
    'workforce.devices.enroll-biometric',
    'workforce.devices.revoke',
    'workforce.people.read',
  ],

  AUDITOR: [
    'workforce.audit.read',
    'workforce.people.read',
    'workforce.attendance.read.all',
    'workforce.payroll.read',
    'workforce.scheduling.read',
  ],

  // ตั้งค่าองค์กร/role ได้ แต่ไม่เห็นเงินเดือนโดยอัตโนมัติ (spec §5)
  TENANT_ADMIN: [
    'workforce.people.read',
    'workforce.people.manage',
    'workforce.settings.manage',
    'workforce.audit.read',
    'workforce.devices.read',
    'workforce.scheduling.read',
  ],

  // JIT: role assignment ต้องมี expires_at + reason บังคับ (ADR-0006)
  SUPPORT_OPERATOR: ['workforce.people.read', 'workforce.audit.read'],
};
