import { AppError } from '@workforce/domain';

/** สถานะของ payroll run (spec §10) */
export type PayrollRunStatus =
  | 'DRAFT'
  | 'CALCULATING'
  | 'CALCULATED'
  | 'REVIEW'
  | 'APPROVED'
  | 'LOCKED'
  | 'PAYMENT_PENDING'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'FILED'
  | 'FAILED'
  | 'VOID';

/**
 * การเปลี่ยนสถานะที่อนุญาต
 *
 * spec §10 ระบุทางเดินหน้าและทางย้อนกลับที่อนุญาตไว้ชัดเจน — อะไรที่ไม่อยู่ใน
 * ตารางนี้คือทำไม่ได้ ไม่ใช่ "ยังไม่ได้เขียนโค้ดรองรับ"
 */
const TRANSITIONS: Readonly<Record<PayrollRunStatus, readonly PayrollRunStatus[]>> = {
  DRAFT: ['CALCULATING', 'VOID'],
  CALCULATING: ['CALCULATED', 'FAILED'],
  // refresh ก่อนส่งตรวจ: กลับไป DRAFT เพื่อดึงข้อมูลใหม่ได้
  CALCULATED: ['REVIEW', 'DRAFT', 'CALCULATING', 'VOID'],
  // ตีกลับพร้อมเหตุผล
  REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['LOCKED', 'REVIEW'],
  // หลัง LOCKED แก้ไม่ได้อีก — เดินหน้าได้อย่างเดียว
  LOCKED: ['PAYMENT_PENDING', 'VOID'],
  PAYMENT_PENDING: ['PARTIALLY_PAID', 'PAID'],
  PARTIALLY_PAID: ['PAID'],
  PAID: ['FILED'],
  FILED: [],
  FAILED: ['DRAFT'],
  VOID: [],
};

/** สถานะที่ข้อมูลของ run ถือว่าถูกตรึงแล้ว (spec §10) */
const IMMUTABLE_STATUSES: ReadonlySet<PayrollRunStatus> = new Set<PayrollRunStatus>([
  'LOCKED',
  'PAYMENT_PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'FILED',
  'VOID',
]);

export function canTransition(from: PayrollRunStatus, to: PayrollRunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PayrollRunStatus, to: PayrollRunStatus): void {
  if (!canTransition(from, to)) {
    throw AppError.conflict(`payroll run cannot move from ${from} to ${to}`, {
      meta: { allowed: TRANSITIONS[from] },
    });
  }
}

export function isLocked(status: PayrollRunStatus): boolean {
  return IMMUTABLE_STATUSES.has(status);
}

/**
 * ตรวจว่า run ยังแก้ไขได้หรือไม่
 *
 * หลัง LOCKED การแก้ต้องทำผ่าน adjustment run หรือ off-cycle เท่านั้น (spec §10)
 */
export function assertMutable(status: PayrollRunStatus, operation: string): void {
  if (isLocked(status)) {
    throw AppError.immutable(`payroll run in status ${status}`, {
      detail: `${operation} is not allowed; use an adjustment or off-cycle run instead`,
    });
  }
}

export interface BlockingValidation {
  code: string;
  detail: string;
  waivable: boolean;
}

/**
 * เงื่อนไขที่ต้องผ่านก่อนส่ง run ไปอนุมัติ (spec §10.2)
 *
 * คืนรายการที่ยังไม่ผ่าน — ว่าง = ผ่านหมด
 */
export function validateForSubmission(input: {
  hasClosedTimesheetSnapshot: boolean;
  employeeCount: number;
  negativeNetCount: number;
  calculationErrorCount: number;
  unresolvedBlockingExceptions: number;
  missingRuleSets: readonly string[];
  snapshotHashMatches: boolean;
  waivedCodes: readonly string[];
}): BlockingValidation[] {
  const problems: BlockingValidation[] = [];

  if (!input.hasClosedTimesheetSnapshot) {
    problems.push({
      code: 'NO_CLOSED_TIMESHEET',
      detail: 'the run must be built from a closed timesheet period',
      waivable: false,
    });
  }
  if (input.employeeCount === 0) {
    problems.push({ code: 'NO_EMPLOYEES', detail: 'the run has no employee results', waivable: false });
  }
  if (input.negativeNetCount > 0) {
    problems.push({
      code: 'NEGATIVE_NET_PAY',
      detail: `${String(input.negativeNetCount)} employees have negative net pay`,
      waivable: false,
    });
  }
  if (input.calculationErrorCount > 0) {
    problems.push({
      code: 'CALCULATION_ERRORS',
      detail: `${String(input.calculationErrorCount)} calculation errors are unacknowledged`,
      waivable: false,
    });
  }
  if (input.missingRuleSets.length > 0) {
    problems.push({
      code: 'MISSING_RULE_SETS',
      detail: `no published rule set for: ${input.missingRuleSets.join(', ')}`,
      waivable: false,
    });
  }
  if (!input.snapshotHashMatches) {
    problems.push({
      code: 'SNAPSHOT_DRIFT',
      detail: 'the input snapshot no longer matches its recorded hash',
      waivable: false,
    });
  }
  if (input.unresolvedBlockingExceptions > 0) {
    problems.push({
      code: 'BLOCKING_ATTENDANCE_EXCEPTIONS',
      detail: `${String(input.unresolvedBlockingExceptions)} blocking attendance exceptions are open`,
      waivable: true,
    });
  }

  // waive ได้เฉพาะข้อที่ประกาศว่า waivable — negative net และ snapshot drift ยกเว้นไม่ได้
  return problems.filter(
    (problem) => !(problem.waivable && input.waivedCodes.includes(problem.code)),
  );
}
