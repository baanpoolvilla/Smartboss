import type { EventIntent, LocalDate } from '@workforce/domain';

/** วิธีคิดการมาสาย (spec §7.2) */
export type LatePolicyMode = 'STRICT' | 'GRACE' | 'FLEX';

/** เมื่อเกิน grace แล้วหักอย่างไร — ต้องเลือก ไม่มีค่าที่ "ชัดเจนอยู่แล้ว" */
export type GraceDeduction = 'FULL_FROM_SCHEDULED' | 'EXCESS_OVER_GRACE';

export interface WorkPolicy {
  lateMode: LatePolicyMode;
  graceMinutes: number;
  graceDeduction: GraceDeduction;
  /** FLEX: ช่วงเวลาที่เริ่มงานได้ (นาทีจากเที่ยงคืน) */
  flexStartMinutes: number;
  flexEndMinutes: number;
  /** FLEX: ต้องทำงานให้ครบกี่นาที */
  flexRequiredWorkMinutes: number;
  /** ออกก่อนเวลาเกินกี่นาทีจึงนับ */
  earlyOutToleranceMinutes: number;
  /** punch สองครั้งภายในกี่นาทีถือว่าซ้ำ */
  duplicatePunchWindowMinutes: number;
  /** ความยาวสูงสุดของกะที่ยอมรับ ใช้จับคู่ IN/OUT */
  maxShiftMinutes: number;
  /** ทำงานเกินกี่นาทีถือว่าผิดปกติ */
  excessiveWorkMinutes: number;
  /** นับ OT อัตโนมัติจากเวลาที่เกินกะหรือไม่ */
  otRequiresApproval: boolean;
  otMinimumMinutes: number;
  /** ปัดเศษเวลา OT เป็นช่วงละกี่นาที (0 = ไม่ปัด) */
  otRoundingMinutes: number;
}

export interface BreakRule {
  /** นาทีจากเที่ยงคืนของวันเริ่มกะ */
  startMinutes: number;
  durationMinutes: number;
  paid: boolean;
  /** true = หักอัตโนมัติแม้ไม่มี punch; false = ใช้ punch จริง */
  autoDeduct: boolean;
}

export interface ShiftDefinition {
  id: string;
  code: string;
  /** นาทีจากเที่ยงคืนของ work_date */
  startMinutes: number;
  /** เกิน 1440 = ข้ามคืน (เช่น 22:00–06:00 → start 1320, end 1800) */
  endMinutes: number;
  breaks: readonly BreakRule[];
  /** true = ไม่ต้องมาทำงาน (วันหยุดประจำสัปดาห์) */
  restDay: boolean;
}

export interface Punch {
  eventId: string;
  at: Date;
  intent: EventIntent;
  /** true = มาจาก correction ที่อนุมัติแล้ว ไม่ใช่ raw event */
  adjusted: boolean;
  /** true = ผู้ใช้/อุปกรณ์ระบุเจตนาชัดเจน ไม่ใช่ AUTO */
  trustedIntent: boolean;
  /** true = ถูก ignore ด้วย adjustment */
  ignored: boolean;
  /** true = รอการตรวจสอบความเสี่ยง (Phase 3) — ยังไม่นับเป็นเวลาทำงาน */
  pendingReview: boolean;
}

export type ExceptionCode =
  | 'MISSING_IN'
  | 'MISSING_OUT'
  | 'DUPLICATE_PUNCH'
  | 'OUT_BEFORE_IN'
  | 'NO_SHIFT_ASSIGNED'
  | 'OVERLAPPING_SHIFT'
  | 'CLOCK_ANOMALY'
  | 'UNKNOWN_EMPLOYEE'
  | 'INACTIVE_EMPLOYMENT'
  | 'WRONG_LOCATION'
  | 'LOW_LOCATION_ACCURACY'
  | 'PHOTO_MISSING'
  | 'PHOTO_RISK'
  | 'UNTRUSTED_DEVICE'
  | 'EXCESSIVE_WORK_DURATION'
  | 'UNAPPROVED_OT'
  | 'BREAK_VIOLATION'
  | 'POLICY_NOT_FOUND'
  | 'OFFLINE_EVENT_TOO_OLD'
  | 'AMBIGUOUS_PAIRING'
  | 'PENDING_EVIDENCE_REVIEW';

export interface AttendanceException {
  code: ExceptionCode;
  /** true = ต้องแก้ก่อนปิด timesheet ได้ (spec §10.2) */
  blocking: boolean;
  detail: string;
  eventId?: string;
}

export interface LeaveDay {
  /** นาทีที่ถือว่าลาโดยได้รับค่าจ้าง */
  paidMinutes: number;
  /** นาทีที่ลาโดยไม่ได้รับค่าจ้าง */
  unpaidMinutes: number;
  /** true = ลาเต็มวัน ไม่ต้องมาทำงาน */
  fullDay: boolean;
}

export interface HolidayInfo {
  name: string;
  paid: boolean;
}

export interface AttendanceInput {
  workDate: LocalDate;
  timeZone: string;
  policy: WorkPolicy | null;
  shift: ShiftDefinition | null;
  punches: readonly Punch[];
  holiday: HolidayInfo | null;
  leave: LeaveDay | null;
  employmentActive: boolean;
}

export interface PunchPair {
  inEventId: string | null;
  outEventId: string | null;
  inAt: Date | null;
  outAt: Date | null;
  minutes: number;
}

export interface AttendanceResult {
  workDate: string;
  shiftId: string | null;
  scheduledInAt: Date | null;
  scheduledOutAt: Date | null;
  actualInAt: Date | null;
  actualOutAt: Date | null;

  /**
   * ค่าทั้งหมดแยกกันชัดเจน — spec §7.2 ห้ามใช้แทนกัน
   * ระบบเดิมมีแค่ is_late กับ work_hours จึงตอบไม่ได้ว่าหักเงินจากอะไร
   */
  lateMinutes: number;
  absenceMinutes: number;
  earlyOutMinutes: number;
  workedMinutes: number;
  paidMinutes: number;
  breakMinutes: number;
  unpaidBreakMinutes: number;
  otCandidateMinutes: number;

  isRestDay: boolean;
  isHoliday: boolean;
  isOnLeave: boolean;
  pairs: PunchPair[];
  exceptions: AttendanceException[];
}
