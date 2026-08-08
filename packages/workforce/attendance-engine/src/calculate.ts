import { zonedTimeToUtc } from '@workforce/domain';
import { pairPunches } from './pairing';
import type {
  AttendanceException,
  AttendanceInput,
  AttendanceResult,
  BreakRule,
  PunchPair,
  ShiftDefinition,
  WorkPolicy,
} from './types';

/**
 * คำนวณผลการลงเวลาของหนึ่งวันทำงาน
 *
 * เป็น pure function: input เดิม → output เดิมเสมอ ไม่อ่านนาฬิกา ไม่แตะ DB
 * เพราะผลลัพธ์นี้ต้องคำนวณซ้ำได้เหมือนเดิมตอนตรวจสอบย้อนหลัง (spec §17)
 *
 * กะข้ามคืนใช้ `work_date` ของวันเริ่มกะ ไม่ใช่วันปฏิทินของ OUT (spec §7.1)
 */
export function calculateAttendance(input: AttendanceInput): AttendanceResult {
  const exceptions: AttendanceException[] = [];
  const workDate = input.workDate.toString();

  if (!input.employmentActive) {
    exceptions.push({
      code: 'INACTIVE_EMPLOYMENT',
      blocking: true,
      detail: 'employment was not active on this work date',
    });
  }

  if (input.policy === null) {
    // ไม่มีนโยบาย = คำนวณไม่ได้ ต้องบอกให้ชัด ไม่ใช่ใช้ค่า default เงียบ ๆ
    exceptions.push({
      code: 'POLICY_NOT_FOUND',
      blocking: true,
      detail: 'no work policy is effective on this work date',
    });
    return emptyResult(workDate, input, exceptions);
  }

  const policy = input.policy;
  const pairing = pairPunches(input.punches, {
    duplicateWindowMinutes: policy.duplicatePunchWindowMinutes,
    maxShiftMinutes: policy.maxShiftMinutes,
  });
  exceptions.push(...pairing.exceptions);

  const isRestDay = input.shift?.restDay ?? false;
  const isHoliday = input.holiday !== null;
  const isOnLeave = input.leave !== null;
  const hasAnyPunch = pairing.workPairs.length > 0;

  if (input.shift === null && !isHoliday && !isOnLeave && hasAnyPunch) {
    exceptions.push({
      code: 'NO_SHIFT_ASSIGNED',
      blocking: true,
      detail: 'punches exist but no shift is scheduled for this work date',
    });
  }

  const scheduledInAt =
    input.shift === null
      ? null
      : zonedTimeToUtc(input.workDate, input.shift.startMinutes, input.timeZone);
  const scheduledOutAt =
    input.shift === null
      ? null
      : zonedTimeToUtc(input.workDate, input.shift.endMinutes, input.timeZone);

  const actualInAt = firstIn(pairing.workPairs);
  const actualOutAt = lastOut(pairing.workPairs);

  const workedMinutes = Math.round(
    pairing.workPairs.reduce((total, pair) => total + pair.minutes, 0),
  );

  const breaks = resolveBreaks(input, pairing.workPairs, pairing.breakPairs);
  const netWorkedMinutes = Math.max(0, workedMinutes - breaks.unpaidMinutes);

  const late = computeLate(policy, input.shift, scheduledInAt, actualInAt);
  const earlyOut = computeEarlyOut(policy, input.shift, scheduledOutAt, actualOutAt);
  const absence = computeAbsence({
    input,
    policy,
    netWorkedMinutes,
    hasAnyPunch,
    lateMinutes: late,
    earlyOutMinutes: earlyOut,
  });

  const scheduledMinutes = scheduledWorkMinutes(input.shift, breaks.unpaidMinutes);
  const otCandidate = computeOvertimeCandidate(policy, netWorkedMinutes, scheduledMinutes, {
    isRestDay,
    isHoliday,
  });

  if (otCandidate > 0 && policy.otRequiresApproval) {
    exceptions.push({
      code: 'UNAPPROVED_OT',
      blocking: false,
      detail: `${String(otCandidate)} minutes beyond the schedule require overtime approval`,
    });
  }

  if (netWorkedMinutes > policy.excessiveWorkMinutes) {
    exceptions.push({
      code: 'EXCESSIVE_WORK_DURATION',
      blocking: false,
      detail: `worked ${String(netWorkedMinutes)} minutes, above the configured maximum`,
    });
  }

  // paid = เวลาที่ทำงานจริง + เวลาพักที่ได้รับค่าจ้าง + เวลาลาที่ได้รับค่าจ้าง
  // ไม่รวม OT เพราะ OT จ่ายด้วยตัวคูณคนละอัตรา (Phase 6)
  const paidMinutes =
    Math.max(0, netWorkedMinutes - otCandidate) +
    breaks.paidMinutes +
    (input.leave?.paidMinutes ?? 0);

  return {
    workDate,
    shiftId: input.shift?.id ?? null,
    scheduledInAt,
    scheduledOutAt,
    actualInAt,
    actualOutAt,
    lateMinutes: late,
    absenceMinutes: absence,
    earlyOutMinutes: earlyOut,
    workedMinutes: netWorkedMinutes,
    paidMinutes,
    breakMinutes: breaks.paidMinutes + breaks.unpaidMinutes,
    unpaidBreakMinutes: breaks.unpaidMinutes,
    otCandidateMinutes: otCandidate,
    isRestDay,
    isHoliday,
    isOnLeave,
    pairs: pairing.workPairs,
    exceptions,
  };
}

function emptyResult(
  workDate: string,
  input: AttendanceInput,
  exceptions: AttendanceException[],
): AttendanceResult {
  return {
    workDate,
    shiftId: input.shift?.id ?? null,
    scheduledInAt: null,
    scheduledOutAt: null,
    actualInAt: null,
    actualOutAt: null,
    lateMinutes: 0,
    absenceMinutes: 0,
    earlyOutMinutes: 0,
    workedMinutes: 0,
    paidMinutes: 0,
    breakMinutes: 0,
    unpaidBreakMinutes: 0,
    otCandidateMinutes: 0,
    isRestDay: input.shift?.restDay ?? false,
    isHoliday: input.holiday !== null,
    isOnLeave: input.leave !== null,
    pairs: [],
    exceptions,
  };
}

function firstIn(pairs: readonly PunchPair[]): Date | null {
  for (const pair of pairs) if (pair.inAt !== null) return pair.inAt;
  return null;
}

function lastOut(pairs: readonly PunchPair[]): Date | null {
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const pair = pairs[index];
    if (pair?.outAt != null) return pair.outAt;
  }
  return null;
}

/**
 * เวลาพัก
 *
 * `autoDeduct` หักตามตารางแม้ไม่มี punch — เหมาะกับพักกลางวันที่ทุกคนพักพร้อมกัน
 * ถ้าไม่ใช่ autoDeduct จะใช้เวลาพักจาก punch จริง ซึ่งแม่นกว่าแต่ต้องให้พนักงานกด
 */
function resolveBreaks(
  input: AttendanceInput,
  workPairs: readonly PunchPair[],
  breakPairs: readonly PunchPair[],
): { paidMinutes: number; unpaidMinutes: number } {
  const rules = input.shift?.breaks ?? [];
  let paidMinutes = 0;
  let unpaidMinutes = 0;

  for (const rule of rules) {
    if (!rule.autoDeduct) continue;

    // หักเฉพาะส่วนของช่วงพักที่คาบเกี่ยวกับเวลาที่ทำงานจริง
    // คนที่เข้างานบ่ายโมงต้องไม่ถูกหักพักกลางวันที่ผ่านไปแล้ว และคนที่ลาทั้งวัน
    // ต้องไม่ถูกหักเลย
    const breakStart = zonedTimeToUtc(input.workDate, rule.startMinutes, input.timeZone);
    const breakEnd = zonedTimeToUtc(
      input.workDate,
      rule.startMinutes + rule.durationMinutes,
      input.timeZone,
    );

    let overlapMinutes = 0;
    for (const pair of workPairs) {
      if (pair.inAt === null || pair.outAt === null) continue;
      const start = Math.max(pair.inAt.getTime(), breakStart.getTime());
      const end = Math.min(pair.outAt.getTime(), breakEnd.getTime());
      if (end > start) overlapMinutes += (end - start) / 60_000;
    }

    const deducted = Math.round(Math.min(rule.durationMinutes, overlapMinutes));
    if (deducted === 0) continue;
    if (rule.paid) paidMinutes += deducted;
    else unpaidMinutes += deducted;
  }

  const punchedBreakMinutes = Math.round(
    breakPairs.reduce((total, pair) => total + pair.minutes, 0),
  );

  if (punchedBreakMinutes > 0) {
    const anyUnpaidRule = rules.some((rule: BreakRule) => !rule.paid);
    if (anyUnpaidRule || rules.length === 0) unpaidMinutes += punchedBreakMinutes;
    else paidMinutes += punchedBreakMinutes;
  }

  return { paidMinutes, unpaidMinutes };
}

/** spec §7.2 — สามโหมด ผลต่างกันชัดเจน */
function computeLate(
  policy: WorkPolicy,
  shift: ShiftDefinition | null,
  scheduledInAt: Date | null,
  actualInAt: Date | null,
): number {
  if (shift === null || shift.restDay) return 0;
  if (scheduledInAt === null || actualInAt === null) return 0;

  const differenceMinutes = (actualInAt.getTime() - scheduledInAt.getTime()) / 60_000;
  if (differenceMinutes <= 0) return 0;

  switch (policy.lateMode) {
    case 'STRICT':
      return Math.round(differenceMinutes);

    case 'GRACE': {
      if (differenceMinutes <= policy.graceMinutes) return 0;
      // เกิน grace แล้วหักทั้งช่วง หรือหักเฉพาะส่วนเกิน — เป็นการตัดสินใจของนโยบาย
      return policy.graceDeduction === 'FULL_FROM_SCHEDULED'
        ? Math.round(differenceMinutes)
        : Math.round(differenceMinutes - policy.graceMinutes);
    }

    case 'FLEX': {
      // FLEX ไม่สนใจว่ามาช้าแค่ไหน ตราบใดที่ยังอยู่ในหน้าต่างที่อนุญาต
      const actualStartMinutes = shift.startMinutes + differenceMinutes;
      if (actualStartMinutes <= policy.flexEndMinutes) return 0;
      return Math.round(actualStartMinutes - policy.flexEndMinutes);
    }
  }
}

function computeEarlyOut(
  policy: WorkPolicy,
  shift: ShiftDefinition | null,
  scheduledOutAt: Date | null,
  actualOutAt: Date | null,
): number {
  if (shift === null || shift.restDay) return 0;
  // FLEX วัดจากจำนวนชั่วโมงที่ทำได้ ไม่ใช่เวลาที่กลับ
  if (policy.lateMode === 'FLEX') return 0;
  if (scheduledOutAt === null || actualOutAt === null) return 0;

  const differenceMinutes = (scheduledOutAt.getTime() - actualOutAt.getTime()) / 60_000;
  if (differenceMinutes <= policy.earlyOutToleranceMinutes) return 0;
  return Math.round(differenceMinutes);
}

/**
 * เวลาที่ขาดไป
 *
 * ระบบเดิมนับขาดงานจาก "จำนวนพนักงานทั้งหมด ลบคนที่มี IN" โดยไม่ดูวันหยุด กะ
 * หรือการลาเลย (spec §3.3 A5) ที่นี่คิดจากตารางที่ต้องทำงานจริงเท่านั้น
 */
function computeAbsence(context: {
  input: AttendanceInput;
  policy: WorkPolicy;
  netWorkedMinutes: number;
  hasAnyPunch: boolean;
  lateMinutes: number;
  earlyOutMinutes: number;
}): number {
  const { input, policy, netWorkedMinutes } = context;
  const shift = input.shift;

  // ไม่ต้องมาทำงาน = ไม่มีการขาดงาน
  if (shift === null || shift.restDay) return 0;
  if (input.holiday !== null) return 0;
  if (input.leave?.fullDay === true) return 0;

  const requiredMinutes =
    policy.lateMode === 'FLEX'
      ? policy.flexRequiredWorkMinutes
      : scheduledWorkMinutes(shift, unpaidBreakMinutes(shift));

  const leaveMinutes = (input.leave?.paidMinutes ?? 0) + (input.leave?.unpaidMinutes ?? 0);
  const shortfall = requiredMinutes - netWorkedMinutes - leaveMinutes;
  return shortfall <= 0 ? 0 : Math.round(shortfall);
}

function unpaidBreakMinutes(shift: ShiftDefinition | null): number {
  if (shift === null) return 0;
  return shift.breaks
    .filter((rule) => !rule.paid && rule.autoDeduct)
    .reduce((total, rule) => total + rule.durationMinutes, 0);
}

function scheduledWorkMinutes(shift: ShiftDefinition | null, unpaidBreak: number): number {
  if (shift === null || shift.restDay) return 0;
  return Math.max(0, shift.endMinutes - shift.startMinutes - unpaidBreak);
}

/**
 * เวลาที่อาจเป็น OT
 *
 * เป็นเพียง "ผู้สมัคร" ไม่ใช่ OT ที่อนุมัติแล้ว — spec §8.3 กำหนดว่า eligible
 * มาจาก policy เช่น `min(planned, actual)` และต้องผ่านการอนุมัติ (Phase 5)
 */
function computeOvertimeCandidate(
  policy: WorkPolicy,
  netWorkedMinutes: number,
  scheduledMinutes: number,
  context: { isRestDay: boolean; isHoliday: boolean },
): number {
  // ทำงานในวันหยุดหรือวันหยุดประจำสัปดาห์ นับเป็น OT ทั้งหมด
  const baseline = context.isRestDay || context.isHoliday ? 0 : scheduledMinutes;
  const excess = netWorkedMinutes - baseline;
  if (excess < policy.otMinimumMinutes) return 0;

  if (policy.otRoundingMinutes > 0) {
    return Math.floor(excess / policy.otRoundingMinutes) * policy.otRoundingMinutes;
  }
  return Math.round(excess);
}
