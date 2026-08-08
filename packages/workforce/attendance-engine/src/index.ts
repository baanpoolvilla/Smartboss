export { calculateAttendance } from './calculate';
export { pairPunches, type PairingResult } from './pairing';
export type {
  AttendanceException,
  AttendanceInput,
  AttendanceResult,
  BreakRule,
  ExceptionCode,
  GraceDeduction,
  HolidayInfo,
  LatePolicyMode,
  LeaveDay,
  Punch,
  PunchPair,
  ShiftDefinition,
  WorkPolicy,
} from './types';

/**
 * นโยบายอ้างอิงสำหรับ dev/test
 *
 * **ไม่ใช่ค่าที่ผ่านการรับรอง** — ค่าจริงต้องมาจาก rule matrix ที่ HR/บัญชี/กฎหมาย
 * เซ็นแล้ว (docs/phase0/rule-matrix.md) และเก็บเป็น work_policies ที่มี effective date
 */
export const REFERENCE_WORK_POLICY = {
  lateMode: 'GRACE',
  graceMinutes: 15,
  graceDeduction: 'EXCESS_OVER_GRACE',
  flexStartMinutes: 7 * 60,
  flexEndMinutes: 10 * 60,
  flexRequiredWorkMinutes: 8 * 60,
  earlyOutToleranceMinutes: 0,
  duplicatePunchWindowMinutes: 3,
  maxShiftMinutes: 16 * 60,
  excessiveWorkMinutes: 14 * 60,
  otRequiresApproval: true,
  otMinimumMinutes: 30,
  otRoundingMinutes: 30,
} as const;
