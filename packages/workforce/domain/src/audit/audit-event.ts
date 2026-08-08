/** spec §17 — รายการที่ต้อง audit อย่างน้อย */

export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED';

export type AuditActorType = 'PRINCIPAL' | 'DEVICE' | 'SYSTEM' | 'SUPPORT_OPERATOR';

export interface AuditEventInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceVersion?: number | null;
  outcome: AuditOutcome;
  /** บังคับสำหรับ waive/override/impersonate/reopen — ดู REASON_REQUIRED_ACTIONS */
  reason?: string | null;
  companyId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Action ที่ต้องมีเหตุผลกำกับเสมอ
 * ถ้าไม่มี reason ระบบต้องปฏิเสธ ไม่ใช่บันทึกเป็นค่าว่าง
 */
export const REASON_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  'attendance.exception.waive',
  'attendance.correction.approve',
  'timesheet.period.reopen',
  'payroll.run.reject',
  'payroll.run.void',
  'payroll.validation.waive',
  'device.credential.revoke',
  'biometric.enrollment.delete',
  'principal.impersonate',
  'support.access.grant',
  'retention.legal-hold.apply',
]);

export function requiresReason(action: string): boolean {
  return REASON_REQUIRED_ACTIONS.has(action);
}
