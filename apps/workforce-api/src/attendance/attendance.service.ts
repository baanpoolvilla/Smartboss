import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  calculateAttendance,
  type AttendanceResult,
  type Punch,
  type ShiftDefinition,
  type WorkPolicy,
} from '@workforce/attendance-engine';
import type { AppConfig } from '@workforce/config';
import { schema, type Tx } from '@workforce/db';
import {
  AppError,
  LocalDate,
  uuidv7,
  zonedTimeToUtc,
  type Clock,
  type EventIntent,
} from '@workforce/domain';
import { eq } from 'drizzle-orm';
import { UnitOfWork, type UnitOfWorkContext } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { APP_CONFIG, CLOCK } from '../shared/tokens';
import { LeaveService } from '../workflow/leave.service';
import { AttendanceRepository } from './attendance.repository';

/**
 * หน้าต่างเวลาที่ใช้ดึงการสแกนของวันทำงานหนึ่งวัน
 *
 * ผูกปลายหน้าต่างกับเวลา *เลิกกะ* ไม่ใช่เวลาเข้ากะ — ถ้าวัดจากเวลาเข้าอย่างเดียว
 * หน้าต่างของวันหนึ่งจะกินไปถึงกะของวันถัดไป แล้วดึงการสแกนของวันพรุ่งนี้มาคิดเป็น
 * "มาสายข้ามคืน" ทั้งที่วันนี้ไม่มีใครมา (ผลคือวันเดียวกันขึ้นทั้งขาดงานและสายพร้อมกัน)
 *
 * ท้ายกะเผื่อ 8 ชั่วโมงให้ครอบ OT ที่ยาวผิดปกติ ส่วนหัวกะเผื่อ 6 ชั่วโมงให้คนมาก่อนเวลา
 * กะข้ามคืนไม่มีปัญหาเพราะ endMinutes ของกะแบบนั้นมากกว่า 1440 อยู่แล้ว
 */
const WINDOW_BEFORE_MINUTES = 6 * 60;
const WINDOW_AFTER_SHIFT_END_MINUTES = 8 * 60;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: AttendanceRepository,
    private readonly leave: LeaveService,
    private readonly requestContext: RequestContextService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * คำนวณผลการลงเวลาของหนึ่งวันแล้วบันทึกเป็น version ใหม่
   *
   * ไม่แก้ผลลัพธ์เดิมในที่เดิม — version เก่ายังอ่านได้เพื่อสอบทานย้อนหลังว่า
   * ตอนปิดงวดเห็นตัวเลขอะไร (ADR-0012)
   */
  async recalculate(
    employmentId: string,
    workDate: string,
    reason = 'MANUAL',
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) =>
      this.recalculateWithin(uow, employmentId, workDate, reason),
    );
  }

  async recalculateRange(
    employmentId: string,
    from: string,
    to: string,
    reason = 'RANGE',
  ): Promise<{ recalculated: number }> {
    const start = LocalDate.parse(from);
    const end = LocalDate.parse(to);
    if (end.isBefore(start)) throw AppError.validation('to must not be before from');
    const days = start.daysUntil(end);
    if (days > 366) throw AppError.validation('range must not exceed 366 days');

    return this.uow.run(async (uow) => {
      let recalculated = 0;
      for (let offset = 0; offset <= days; offset += 1) {
        await this.recalculateWithin(uow, employmentId, start.plusDays(offset).toString(), reason);
        recalculated += 1;
      }
      return { recalculated };
    });
  }

  private async recalculateWithin(
    uow: UnitOfWorkContext,
    employmentId: string,
    workDateText: string,
    reason: string,
  ): Promise<Record<string, unknown>> {
    const workDate = LocalDate.parse(workDateText);

    const employments = await uow.tx
      .select()
      .from(schema.employments)
      .where(eq(schema.employments.id, employmentId))
      .limit(1);
    const employment = employments[0];
    if (employment === undefined) throw AppError.notFound('employment');

    const timeZone = employment.timeZone;
    const policyRow = await this.repository.resolveWorkPolicy(
      uow.tx,
      employment.companyId,
      workDateText,
    );
    const { shiftId } = await this.repository.resolveShiftId(uow.tx, employmentId, workDateText);
    const shiftData = shiftId === null ? undefined : await this.repository.findShiftWithBreaks(uow.tx, shiftId);
    const holiday = await this.repository.findHoliday(uow.tx, employment.companyId, workDateText);

    const { punches, adjustmentPunchIds } = await this.collectPunches(uow.tx, {
      employmentId,
      workDate,
      workDateText,
      timeZone,
      shiftStartMinutes: shiftData?.shift.startMinutes ?? 0,
      shiftEndMinutes: shiftData?.shift.endMinutes ?? 24 * 60,
    });

    // การลาที่อนุมัติแล้วของวันนี้ — ทำให้วันที่ลาไม่ถูกนับเป็นขาดงาน (spec §7.1)
    const leaveByDate = await this.leave.approvedMinutesByDate(
      uow.tx,
      employmentId,
      workDateText,
      workDateText,
    );
    const leaveMinutes = leaveByDate.get(workDateText);
    const scheduledMinutes =
      shiftData === undefined || shiftData.shift.restDay
        ? 0
        : shiftData.shift.endMinutes - shiftData.shift.startMinutes;
    const leaveForDay =
      leaveMinutes === undefined
        ? null
        : {
            paidMinutes: leaveMinutes.paid,
            unpaidMinutes: leaveMinutes.unpaid,
            // ลาเต็มวันเมื่อครอบคลุมเวลาทำงานตามตารางทั้งหมด
            fullDay:
              scheduledMinutes > 0 &&
              leaveMinutes.paid + leaveMinutes.unpaid >= scheduledMinutes,
          };

    const employmentActive =
      LocalDate.parse(employment.hiredOn).isOnOrBefore(workDate) &&
      (employment.terminatedOn === null ||
        LocalDate.parse(employment.terminatedOn).isOnOrAfter(workDate));

    const result = calculateAttendance({
      workDate,
      timeZone,
      policy: policyRow === undefined ? null : toEnginePolicy(policyRow),
      shift: shiftData === undefined ? null : toEngineShift(shiftData.shift, shiftData.breaks),
      punches,
      holiday: holiday === undefined ? null : { name: holiday.name, paid: holiday.paid },
      leave: leaveForDay,
      employmentActive,
    });

    const previousVersion = await this.repository.supersedeCurrentResult(
      uow.tx,
      employmentId,
      workDateText,
    );
    await this.repository.closeSupersededExceptions(uow.tx, employmentId, workDateText);

    const resultId = uuidv7();
    const blocking = result.exceptions.some((exception) => exception.blocking);

    await this.repository.insertResult(uow.tx, {
      id: resultId,
      tenantId: uow.tenantId,
      companyId: employment.companyId,
      employmentId,
      workDate: workDateText,
      resultVersion: previousVersion + 1,
      isCurrent: true,
      shiftId,
      workPolicyId: policyRow?.id ?? null,
      scheduledInAt: result.scheduledInAt,
      scheduledOutAt: result.scheduledOutAt,
      actualInAt: result.actualInAt,
      actualOutAt: result.actualOutAt,
      lateMinutes: result.lateMinutes,
      absenceMinutes: result.absenceMinutes,
      earlyOutMinutes: result.earlyOutMinutes,
      workedMinutes: result.workedMinutes,
      paidMinutes: result.paidMinutes,
      breakMinutes: result.breakMinutes,
      unpaidBreakMinutes: result.unpaidBreakMinutes,
      otCandidateMinutes: result.otCandidateMinutes,
      isRestDay: result.isRestDay,
      isHoliday: result.isHoliday,
      isOnLeave: result.isOnLeave,
      hasBlockingException: blocking,
      calculatedAt: this.clock.now(),
      calculationReason: reason,
      // digest ของ input ที่ใช้คำนวณ — พิสูจน์ได้ว่า version นี้มาจากข้อมูลชุดไหน
      inputDigest: digestInput(punches, shiftId, policyRow?.id ?? null),
    });

    await this.repository.insertPunches(
      uow.tx,
      result.pairs.map((pair, index) => {
        const fromAdjustment = (id: string | null): boolean =>
          id !== null && adjustmentPunchIds.has(id);
        return {
          id: uuidv7(),
          tenantId: uow.tenantId,
          resultId,
          sequence: index,
          inEventId: fromAdjustment(pair.inEventId) ? null : pair.inEventId,
          outEventId: fromAdjustment(pair.outEventId) ? null : pair.outEventId,
          inAdjustmentId: fromAdjustment(pair.inEventId) ? pair.inEventId : null,
          outAdjustmentId: fromAdjustment(pair.outEventId) ? pair.outEventId : null,
          inAt: pair.inAt,
          outAt: pair.outAt,
          minutes: Math.round(pair.minutes),
        };
      }),
    );

    await this.repository.insertExceptions(
      uow.tx,
      result.exceptions.map((exception) => ({
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: employment.companyId,
        employmentId,
        resultId,
        workDate: workDateText,
        code: exception.code,
        blocking: exception.blocking,
        detail: exception.detail,
        rawEventId:
          exception.eventId !== undefined && !adjustmentPunchIds.has(exception.eventId)
            ? exception.eventId
            : null,
        status: 'OPEN',
      })),
    );

    return toResultView(result, resultId, previousVersion + 1);
  }

  /**
   * รวม punch ที่ใช้คำนวณ = raw event + การแก้ที่อนุมัติแล้ว
   *
   * raw event ไม่เคยถูกแก้ — adjustment เป็นชั้นที่ทับลงไปตอนคำนวณเท่านั้น (spec §7.4)
   */
  private async collectPunches(
    tx: Tx,
    context: {
      employmentId: string;
      workDate: LocalDate;
      workDateText: string;
      timeZone: string;
      shiftStartMinutes: number;
      shiftEndMinutes: number;
    },
  ): Promise<{ punches: Punch[]; adjustmentPunchIds: Set<string> }> {
    const windowFrom = zonedTimeToUtc(
      context.workDate,
      context.shiftStartMinutes - WINDOW_BEFORE_MINUTES,
      context.timeZone,
    );
    const windowTo = zonedTimeToUtc(
      context.workDate,
      context.shiftEndMinutes + WINDOW_AFTER_SHIFT_END_MINUTES,
      context.timeZone,
    );

    const events = await this.repository.listEventsForWindow(
      tx,
      context.employmentId,
      windowFrom,
      windowTo,
    );
    const adjustments = await this.repository.listApprovedAdjustments(
      tx,
      context.employmentId,
      context.workDateText,
    );

    const ignored = new Set(
      adjustments
        .filter((adjustment) => adjustment.adjustmentType === 'IGNORE_EVENT')
        .map((adjustment) => adjustment.targetEventId),
    );
    const intentChanges = new Map(
      adjustments
        .filter((adjustment) => adjustment.adjustmentType === 'CHANGE_INTENT')
        .map((adjustment) => [adjustment.targetEventId, adjustment.eventIntent]),
    );

    const punches: Punch[] = events.map((event) => {
      const evidence = event.evidence as Record<string, unknown>;
      const changedIntent = intentChanges.get(event.id);
      return {
        eventId: event.id,
        at: event.capturedAt,
        intent: (changedIntent ?? event.eventIntent) as EventIntent,
        adjusted: changedIntent !== undefined,
        trustedIntent: event.eventIntent !== 'AUTO',
        ignored: ignored.has(event.id),
        // check-in ที่รอตรวจหลักฐานยังไม่นับเป็นเวลาทำงาน (Phase 3 → Phase 4)
        pendingReview: evidence['requires_review'] === true,
      };
    });

    const adjustmentPunchIds = new Set<string>();
    for (const adjustment of adjustments) {
      if (adjustment.adjustmentType !== 'ADD_PUNCH' || adjustment.punchAt === null) continue;
      adjustmentPunchIds.add(adjustment.id);
      punches.push({
        eventId: adjustment.id,
        at: adjustment.punchAt,
        intent: (adjustment.eventIntent ?? 'AUTO') as EventIntent,
        adjusted: true,
        trustedIntent: true,
        ignored: false,
        pendingReview: false,
      });
    }

    return { punches, adjustmentPunchIds };
  }

  // --- queries ---

  /**
   * สรุปสถิติการเข้างานในช่วงวันที่ สำหรับหน้า dashboard
   *
   * รวมยอดที่ฝั่งเซิร์ฟเวอร์ ไม่ส่งแถวดิบทั้งหมดไปให้เบราว์เซอร์บวกเอง —
   * พนักงาน 200 คน 30 วันคือ 6,000 แถว ซึ่งเปลืองทั้งเน็ตและแรมของเครื่องผู้ใช้
   */
  async summarize(query: {
    companyId?: string;
    from: string;
    to: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listResults(uow.tx, query);

      const perEmployee = new Map<
        string,
        {
          employment_id: string;
          days: number;
          worked_days: number;
          worked_minutes: number;
          late_minutes: number;
          late_days: number;
          early_out_minutes: number;
          absence_minutes: number;
          absent_days: number;
          ot_minutes: number;
        }
      >();

      const totals = {
        days: 0,
        worked_days: 0,
        worked_minutes: 0,
        late_minutes: 0,
        late_days: 0,
        early_out_minutes: 0,
        absence_minutes: 0,
        absent_days: 0,
        ot_minutes: 0,
      };

      for (const row of rows) {
        const key = row.employmentId;
        const entry = perEmployee.get(key) ?? {
          employment_id: key,
          days: 0,
          worked_days: 0,
          worked_minutes: 0,
          late_minutes: 0,
          late_days: 0,
          early_out_minutes: 0,
          absence_minutes: 0,
          absent_days: 0,
          ot_minutes: 0,
        };

        entry.days += 1;
        // แยก "วันที่มีข้อมูล" ออกจาก "วันที่มาทำงานจริง" — ถ้ารวมกัน ค่าเฉลี่ยชั่วโมง
        // ต่อวันจะถูกหารด้วยวันหยุดและวันขาดงานไปด้วย จนได้ตัวเลขที่ไม่มีความหมาย
        if (row.workedMinutes > 0) entry.worked_days += 1;
        entry.worked_minutes += row.workedMinutes;
        entry.late_minutes += row.lateMinutes;
        entry.early_out_minutes += row.earlyOutMinutes;
        entry.absence_minutes += row.absenceMinutes;
        entry.ot_minutes += row.otCandidateMinutes;
        // นับเป็น "วันที่สาย" เมื่อสายจริง ไม่ใช่นับทุกวันที่มีสถิติ
        if (row.lateMinutes > 0) entry.late_days += 1;
        if (row.absenceMinutes > 0) entry.absent_days += 1;

        perEmployee.set(key, entry);

        totals.days += 1;
        if (row.workedMinutes > 0) totals.worked_days += 1;
        totals.worked_minutes += row.workedMinutes;
        totals.late_minutes += row.lateMinutes;
        totals.early_out_minutes += row.earlyOutMinutes;
        totals.absence_minutes += row.absenceMinutes;
        totals.ot_minutes += row.otCandidateMinutes;
        if (row.lateMinutes > 0) totals.late_days += 1;
        if (row.absenceMinutes > 0) totals.absent_days += 1;
      }

      const employees = [...perEmployee.values()].sort(
        (left, right) => right.late_minutes - left.late_minutes,
      );

      return {
        from: query.from,
        to: query.to,
        totals: { ...totals, employees: employees.length },
        employees,
      };
    });
  }

  async listResults(query: {
    employmentId?: string;
    companyId?: string;
    from: string;
    to: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listResults(uow.tx, query);
      return { items: rows.map(toStoredResultView) };
    });
  }

  async listExceptions(query: {
    companyId?: string;
    employmentId?: string;
    status?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await this.repository.listExceptions(uow.tx, query);
      return {
        items: rows.map((row) => ({
          id: row.id,
          employment_id: row.employmentId,
          work_date: row.workDate,
          code: row.code,
          blocking: row.blocking,
          detail: row.detail,
          status: row.status,
          resolution_reason: row.resolutionReason,
          created_at: row.createdAt.toISOString(),
        })),
      };
    });
  }

  /**
   * ปิด exception โดยระบุเหตุผล
   *
   * `WAIVED` คือการยอมรับความผิดปกติไว้อย่างรู้ตัว จึงบังคับให้มีเหตุผลและถูก audit
   * (spec §10.2 อนุญาตให้ปิดงวดได้เมื่อ exception ถูก waive พร้อมเหตุผล)
   */
  async resolveException(
    exceptionId: string,
    input: { outcome: 'RESOLVED' | 'WAIVED'; reason: string },
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const exception = await this.repository.findExceptionById(uow.tx, exceptionId);
      if (exception === undefined) throw AppError.notFound('attendance exception');
      if (exception.status !== 'OPEN') throw AppError.conflict('exception is not open');

      await this.repository.updateException(uow.tx, exceptionId, {
        status: input.outcome,
        resolvedAt: this.clock.now(),
        resolvedBy: this.requestContext.requirePrincipal().principalId,
        resolutionReason: input.reason,
      });

      await uow.audit({
        action: 'attendance.exception.waive',
        resourceType: 'attendance_exception',
        resourceId: exceptionId,
        outcome: 'SUCCESS',
        companyId: exception.companyId,
        reason: input.reason,
        before: { status: exception.status, code: exception.code },
        after: { status: input.outcome },
      });

      return { id: exceptionId, status: input.outcome };
    });
  }

  // --- corrections (spec §7.4) ---

  async requestAdjustment(input: {
    employment_id: string;
    work_date: string;
    adjustment_type: 'ADD_PUNCH' | 'IGNORE_EVENT' | 'CHANGE_INTENT';
    target_event_id: string | null;
    punch_at: string | null;
    event_intent: string | null;
    reason: string;
    comment: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const employments = await uow.tx
        .select()
        .from(schema.employments)
        .where(eq(schema.employments.id, input.employment_id))
        .limit(1);
      const employment = employments[0];
      if (employment === undefined) throw AppError.notFound('employment');

      if (input.adjustment_type === 'ADD_PUNCH') {
        if (input.punch_at === null || input.event_intent === null) {
          throw AppError.validation('ADD_PUNCH requires punch_at and event_intent');
        }
        // ตรวจว่าเวลาที่ขอเพิ่มอยู่ในวันทำงานที่อ้าง ไม่ใช่วันอื่น
        const punchDate = LocalDate.fromInstant(new Date(input.punch_at), employment.timeZone);
        const workDate = LocalDate.parse(input.work_date);
        if (punchDate.daysUntil(workDate) > 1 || workDate.daysUntil(punchDate) > 1) {
          throw AppError.validation('punch_at is not within one day of work_date');
        }
      } else if (input.target_event_id === null) {
        throw AppError.validation(`${input.adjustment_type} requires target_event_id`);
      }

      const row = await this.repository.insertAdjustment(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        companyId: employment.companyId,
        employmentId: input.employment_id,
        workDate: input.work_date,
        adjustmentType: input.adjustment_type,
        targetEventId: input.target_event_id,
        punchAt: input.punch_at === null ? null : new Date(input.punch_at),
        eventIntent: input.event_intent,
        reason: input.reason,
        comment: input.comment,
        status: 'PENDING',
        requestedBy: this.requestContext.requirePrincipal().principalId,
      });

      await uow.audit({
        action: 'attendance.correction.request',
        resourceType: 'time_event_adjustment',
        resourceId: row.id,
        outcome: 'SUCCESS',
        companyId: employment.companyId,
        after: {
          adjustment_type: row.adjustmentType,
          work_date: row.workDate,
          reason: row.reason,
        },
      });

      return { id: row.id, status: row.status };
    });
  }

  /**
   * อนุมัติคำขอแก้เวลา แล้วคำนวณผลของวันนั้นใหม่ทันที
   *
   * ผู้อนุมัติต้องไม่ใช่ผู้ขอ — การแก้เวลาของตัวเองแล้วอนุมัติเองทำให้ระบบ
   * ไม่มีความหมาย (spec §5, §10.2 maker-checker)
   */
  async approveAdjustment(
    adjustmentId: string,
    input: { reason: string },
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const adjustment = await this.repository.findAdjustmentById(uow.tx, adjustmentId);
      if (adjustment === undefined) throw AppError.notFound('time event adjustment');
      if (adjustment.status !== 'PENDING') throw AppError.conflict('adjustment is not pending');

      const approverId = this.requestContext.requirePrincipal().principalId;
      if (adjustment.requestedBy === approverId) {
        throw AppError.forbidden('the approver must be different from the requester');
      }

      await this.repository.updateAdjustment(uow.tx, adjustmentId, {
        status: 'APPROVED',
        approvedBy: approverId,
        approvedAt: this.clock.now(),
      });

      await uow.audit({
        action: 'attendance.correction.approve',
        resourceType: 'time_event_adjustment',
        resourceId: adjustmentId,
        outcome: 'SUCCESS',
        companyId: adjustment.companyId,
        reason: input.reason,
        before: { status: 'PENDING' },
        after: { status: 'APPROVED' },
      });

      // สร้าง attendance result version ใหม่ทันที (spec §7.4)
      const recalculated = await this.recalculateWithin(
        uow,
        adjustment.employmentId,
        adjustment.workDate,
        'CORRECTION_APPROVED',
      );

      return { id: adjustmentId, status: 'APPROVED', result: recalculated };
    });
  }
}

function toEnginePolicy(row: typeof schema.workPolicies.$inferSelect): WorkPolicy {
  return {
    lateMode: row.lateMode as WorkPolicy['lateMode'],
    graceMinutes: row.graceMinutes,
    graceDeduction: row.graceDeduction as WorkPolicy['graceDeduction'],
    flexStartMinutes: row.flexStartMinutes,
    flexEndMinutes: row.flexEndMinutes,
    flexRequiredWorkMinutes: row.flexRequiredWorkMinutes,
    earlyOutToleranceMinutes: row.earlyOutToleranceMinutes,
    duplicatePunchWindowMinutes: row.duplicatePunchWindowMinutes,
    maxShiftMinutes: row.maxShiftMinutes,
    excessiveWorkMinutes: row.excessiveWorkMinutes,
    otRequiresApproval: row.otRequiresApproval,
    otMinimumMinutes: row.otMinimumMinutes,
    otRoundingMinutes: row.otRoundingMinutes,
  };
}

function toEngineShift(
  shift: typeof schema.shiftDefinitions.$inferSelect,
  breaks: (typeof schema.shiftBreakRules.$inferSelect)[],
): ShiftDefinition {
  return {
    id: shift.id,
    code: shift.code,
    startMinutes: shift.startMinutes,
    endMinutes: shift.endMinutes,
    restDay: shift.restDay,
    breaks: breaks.map((rule) => ({
      startMinutes: rule.startMinutes,
      durationMinutes: rule.durationMinutes,
      paid: rule.paid,
      autoDeduct: rule.autoDeduct,
    })),
  };
}

function digestInput(punches: readonly Punch[], shiftId: string | null, policyId: string | null): Buffer {
  const canonical = JSON.stringify({
    shiftId,
    policyId,
    punches: punches
      .map((punch) => [punch.eventId, punch.at.toISOString(), punch.intent, punch.ignored])
      .sort(),
  });
  return createHash('sha256').update(canonical).digest();
}

function toResultView(
  result: AttendanceResult,
  resultId: string,
  version: number,
): Record<string, unknown> {
  return {
    id: resultId,
    result_version: version,
    work_date: result.workDate,
    shift_id: result.shiftId,
    scheduled_in_at: result.scheduledInAt?.toISOString() ?? null,
    scheduled_out_at: result.scheduledOutAt?.toISOString() ?? null,
    actual_in_at: result.actualInAt?.toISOString() ?? null,
    actual_out_at: result.actualOutAt?.toISOString() ?? null,
    late_minutes: result.lateMinutes,
    absence_minutes: result.absenceMinutes,
    early_out_minutes: result.earlyOutMinutes,
    worked_minutes: result.workedMinutes,
    paid_minutes: result.paidMinutes,
    break_minutes: result.breakMinutes,
    ot_candidate_minutes: result.otCandidateMinutes,
    is_rest_day: result.isRestDay,
    is_holiday: result.isHoliday,
    is_on_leave: result.isOnLeave,
    exceptions: result.exceptions.map((exception) => ({
      code: exception.code,
      blocking: exception.blocking,
      detail: exception.detail,
    })),
  };
}

function toStoredResultView(
  row: typeof schema.attendanceResults.$inferSelect,
): Record<string, unknown> {
  return {
    id: row.id,
    employment_id: row.employmentId,
    work_date: row.workDate,
    result_version: row.resultVersion,
    shift_id: row.shiftId,
    actual_in_at: row.actualInAt?.toISOString() ?? null,
    actual_out_at: row.actualOutAt?.toISOString() ?? null,
    late_minutes: row.lateMinutes,
    absence_minutes: row.absenceMinutes,
    early_out_minutes: row.earlyOutMinutes,
    worked_minutes: row.workedMinutes,
    paid_minutes: row.paidMinutes,
    break_minutes: row.breakMinutes,
    ot_candidate_minutes: row.otCandidateMinutes,
    is_rest_day: row.isRestDay,
    is_holiday: row.isHoliday,
    is_on_leave: row.isOnLeave,
    has_blocking_exception: row.hasBlockingException,
    calculated_at: row.calculatedAt.toISOString(),
  };
}
