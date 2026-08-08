/**
 * Permission catalog — spec §5
 *
 * ระบบตรวจ permission key เสมอ ไม่ตรวจชื่อ role (ADR-0006)
 * role เป็นเพียงชุดของ permission ที่ตั้งค่าได้
 */
export const PERMISSIONS = [
  'workforce.people.read',
  'workforce.people.manage',

  'workforce.devices.read',
  'workforce.devices.manage',
  'workforce.devices.enroll-biometric',
  'workforce.devices.revoke',

  'workforce.scheduling.read',
  'workforce.scheduling.manage',
  'workforce.scheduling.publish',

  'workforce.attendance.read.self',
  'workforce.attendance.read.team',
  'workforce.attendance.read.all',
  'workforce.attendance.correct.request',
  'workforce.attendance.correct.approve',
  'workforce.attendance.evidence.read',

  'workforce.leave.request',
  'workforce.leave.approve',
  'workforce.leave.manage',

  'workforce.overtime.request',
  'workforce.overtime.approve',
  'workforce.overtime.manage',

  'workforce.timesheet.review',
  'workforce.timesheet.close',
  'workforce.timesheet.reopen',

  'workforce.payroll.read',
  'workforce.payroll.prepare',
  'workforce.payroll.calculate',
  'workforce.payroll.approve',
  'workforce.payroll.lock',
  'workforce.payroll.mark-paid',
  'workforce.payroll.export',

  'workforce.payslip.read.self',
  'workforce.payslip.read.all',

  'workforce.audit.read',
  'workforce.settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value);
}

/**
 * Permission ที่ต้องผ่าน step-up authentication (MFA ที่ยังไม่หมดอายุ)
 * spec §16 — payroll approve/lock/export และการเปิดหลักฐานภาพ
 */
export const STEP_UP_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'workforce.payroll.approve',
  'workforce.payroll.lock',
  'workforce.payroll.export',
  'workforce.attendance.evidence.read',
]);

export function requiresStepUp(permission: Permission): boolean {
  return STEP_UP_PERMISSIONS.has(permission);
}

/**
 * ขอบเขตข้อมูลที่ principal เข้าถึงได้ — resolve จาก permission ที่ลงท้ายด้วย
 * `.self` / `.team` / `.all` ไม่ใช่แค่ boolean (ADR-0006)
 */
export type DataScope = 'SELF' | 'TEAM' | 'COMPANY' | 'TENANT';

const SCOPE_RANK: Record<DataScope, number> = { SELF: 0, TEAM: 1, COMPANY: 2, TENANT: 3 };

export function widestScope(scopes: readonly DataScope[]): DataScope | undefined {
  let widest: DataScope | undefined;
  for (const scope of scopes) {
    if (widest === undefined || SCOPE_RANK[scope] > SCOPE_RANK[widest]) widest = scope;
  }
  return widest;
}

export function scopeCovers(granted: DataScope, required: DataScope): boolean {
  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}
