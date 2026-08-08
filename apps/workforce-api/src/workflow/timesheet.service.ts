import { Inject, Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { AppError, LocalDate, uuidv7, type Clock } from '@workforce/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { CLOCK } from '../shared/tokens';
import { LeaveService } from './leave.service';

/**
 * Timesheet — จุดตัดรอบระหว่าง attendance กับ payroll (spec §10.1)
 *
 * ระบบเดิมรับ `report` จาก frontend แล้วบันทึกเป็น JSON (spec §3.3 P3) แปลว่า
 * เชื่อตัวเลขที่ browser ส่งมา ที่นี่ snapshot ถูกประกอบฝั่ง server จาก
 * attendance result เท่านั้น และตอนปิดงวดจะถูก freeze
 */
@Injectable()
export class TimesheetService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly leave: LeaveService,
    private readonly requestContext: RequestContextService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createPeriod(input: {
    company_id: string;
    name: string;
    starts_on: string;
    ends_on: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      if (LocalDate.parse(input.ends_on).isBefore(LocalDate.parse(input.starts_on))) {
        throw AppError.validation('ends_on must not be before starts_on');
      }

      const id = uuidv7();
      await uow.tx.insert(schema.timesheetPeriods).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        name: input.name,
        startsOn: input.starts_on,
        endsOn: input.ends_on,
        status: 'OPEN',
      });

      await uow.audit({
        action: 'timesheet.period.create',
        resourceType: 'timesheet_period',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { name: input.name, starts_on: input.starts_on, ends_on: input.ends_on },
      });

      return { id, status: 'OPEN' };
    });
  }

  /**
   * สร้าง/รีเฟรช timesheet จาก attendance result ปัจจุบัน
   *
   * เรียกซ้ำได้ตราบใดที่งวดยังไม่ปิด — ตัวเลขจะตามข้อมูลล่าสุดเสมอ
   */
  async generate(periodId: string): Promise<{ employments: number }> {
    return this.uow.run(async (uow) => {
      const periods = await uow.tx
        .select()
        .from(schema.timesheetPeriods)
        .where(eq(schema.timesheetPeriods.id, periodId))
        .limit(1);
      const period = periods[0];
      if (period === undefined) throw AppError.notFound('timesheet period');
      if (period.status === 'CLOSED') {
        throw AppError.conflict('a closed period cannot be regenerated; reopen it first');
      }

      const employments = await uow.tx
        .select()
        .from(schema.employments)
        .where(eq(schema.employments.companyId, period.companyId));

      for (const employment of employments) {
        const results = await uow.tx
          .select()
          .from(schema.attendanceResults)
          .where(
            and(
              eq(schema.attendanceResults.employmentId, employment.id),
              eq(schema.attendanceResults.isCurrent, true),
              sql`${schema.attendanceResults.workDate} >= ${period.startsOn}`,
              sql`${schema.attendanceResults.workDate} <= ${period.endsOn}`,
            ),
          );

        const overtime = await uow.tx
          .select()
          .from(schema.overtimeRequests)
          .where(
            and(
              eq(schema.overtimeRequests.employmentId, employment.id),
              eq(schema.overtimeRequests.status, 'FINAL_APPROVED'),
              sql`${schema.overtimeRequests.workDate} >= ${period.startsOn}`,
              sql`${schema.overtimeRequests.workDate} <= ${period.endsOn}`,
            ),
          );
        const otByDate = new Map(
          overtime.map((row) => [row.workDate, { minutes: row.approvedMinutes, category: row.otCategory }]),
        );

        const leaveByDate = await this.leave.approvedMinutesByDate(
          uow.tx,
          employment.id,
          period.startsOn,
          period.endsOn,
        );

        const timesheetId = await this.upsertTimesheet(uow.tx, {
          tenantId: uow.tenantId,
          periodId,
          employmentId: employment.id,
        });

        // ล้าง snapshot เดิมก่อนเขียนใหม่ — trigger จะปฏิเสธถ้างวดปิดแล้ว
        await uow.tx
          .delete(schema.timesheetDaySnapshots)
          .where(eq(schema.timesheetDaySnapshots.timesheetId, timesheetId));

        const totals = {
          scheduledDays: 0,
          workedDays: 0,
          workedMinutes: 0,
          paidMinutes: 0,
          lateMinutes: 0,
          absenceMinutes: 0,
          earlyOutMinutes: 0,
          paidLeaveMinutes: 0,
          unpaidLeaveMinutes: 0,
          otWorkdayMinutes: 0,
          otRestDayMinutes: 0,
          otHolidayMinutes: 0,
          holidayDays: 0,
          blockingExceptionCount: 0,
        };

        for (const result of results) {
          const leave = leaveByDate.get(result.workDate) ?? { paid: 0, unpaid: 0 };
          const ot = otByDate.get(result.workDate);
          const otMinutes = ot?.minutes ?? 0;

          await uow.tx.insert(schema.timesheetDaySnapshots).values({
            id: uuidv7(),
            tenantId: uow.tenantId,
            timesheetId,
            workDate: result.workDate,
            attendanceResultId: result.id,
            resultVersion: result.resultVersion,
            workedMinutes: result.workedMinutes,
            paidMinutes: result.paidMinutes,
            lateMinutes: result.lateMinutes,
            absenceMinutes: result.absenceMinutes,
            earlyOutMinutes: result.earlyOutMinutes,
            paidLeaveMinutes: leave.paid,
            unpaidLeaveMinutes: leave.unpaid,
            otMinutes,
            otCategory: ot?.category ?? null,
            isRestDay: result.isRestDay,
            isHoliday: result.isHoliday,
          });

          if (!result.isRestDay && !result.isHoliday) totals.scheduledDays += 1;
          if (result.workedMinutes > 0) totals.workedDays += 1;
          if (result.isHoliday) totals.holidayDays += 1;
          totals.workedMinutes += result.workedMinutes;
          totals.paidMinutes += result.paidMinutes;
          totals.lateMinutes += result.lateMinutes;
          totals.absenceMinutes += result.absenceMinutes;
          totals.earlyOutMinutes += result.earlyOutMinutes;
          totals.paidLeaveMinutes += leave.paid;
          totals.unpaidLeaveMinutes += leave.unpaid;
          if (result.hasBlockingException) totals.blockingExceptionCount += 1;

          // OT แยกตามประเภทเพราะตัวคูณต่างกัน (spec §8.3)
          if (ot?.category === 'REST_DAY') totals.otRestDayMinutes += otMinutes;
          else if (ot?.category === 'PUBLIC_HOLIDAY') totals.otHolidayMinutes += otMinutes;
          else totals.otWorkdayMinutes += otMinutes;
        }

        await uow.tx
          .update(schema.timesheets)
          .set({ ...totals, updatedAt: this.clock.now() })
          .where(eq(schema.timesheets.id, timesheetId));
      }

      await uow.audit({
        action: 'timesheet.period.generate',
        resourceType: 'timesheet_period',
        resourceId: periodId,
        outcome: 'SUCCESS',
        companyId: period.companyId,
        metadata: { employments: employments.length },
      });

      return { employments: employments.length };
    });
  }

  private async upsertTimesheet(
    tx: Tx,
    input: { tenantId: string; periodId: string; employmentId: string },
  ): Promise<string> {
    const existing = await tx
      .select({ id: schema.timesheets.id })
      .from(schema.timesheets)
      .where(
        and(
          eq(schema.timesheets.periodId, input.periodId),
          eq(schema.timesheets.employmentId, input.employmentId),
        ),
      )
      .limit(1);

    const found = existing[0];
    if (found !== undefined) return found.id;

    const id = uuidv7();
    await tx.insert(schema.timesheets).values({
      id,
      tenantId: input.tenantId,
      periodId: input.periodId,
      employmentId: input.employmentId,
      status: 'DRAFT',
    });
    return id;
  }

  /**
   * ปิดงวด
   *
   * บล็อกเมื่อยังมี exception ที่ blocking ค้างอยู่ (spec §10.2) — payroll ต้อง
   * ไม่เริ่มจากข้อมูลที่ยังรู้ว่าผิด
   */
  async close(periodId: string, options: { force: boolean; reason: string }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const periods = await uow.tx
        .select()
        .from(schema.timesheetPeriods)
        .where(eq(schema.timesheetPeriods.id, periodId))
        .limit(1);
      const period = periods[0];
      if (period === undefined) throw AppError.notFound('timesheet period');
      if (period.status === 'CLOSED') throw AppError.conflict('period is already closed');

      const blocking = await uow.tx
        .select({ id: schema.timesheets.id, count: schema.timesheets.blockingExceptionCount })
        .from(schema.timesheets)
        .where(
          and(
            eq(schema.timesheets.periodId, periodId),
            sql`${schema.timesheets.blockingExceptionCount} > 0`,
          ),
        );

      if (blocking.length > 0 && !options.force) {
        throw AppError.conflict(
          'the period has unresolved blocking exceptions; resolve or waive them first',
          { meta: { timesheets_with_blocking_exceptions: blocking.length } },
        );
      }

      const now = this.clock.now();
      await uow.tx
        .update(schema.timesheets)
        .set({ status: 'CLOSED', updatedAt: now })
        .where(eq(schema.timesheets.periodId, periodId));

      await uow.tx
        .update(schema.timesheetPeriods)
        .set({
          status: 'CLOSED',
          closedAt: now,
          closedBy: this.requestContext.requirePrincipal().principalId,
          cutoffAt: now,
        })
        .where(eq(schema.timesheetPeriods.id, periodId));

      await uow.audit({
        action: 'timesheet.period.close',
        resourceType: 'timesheet_period',
        resourceId: periodId,
        outcome: 'SUCCESS',
        companyId: period.companyId,
        ...(options.force ? { reason: options.reason } : {}),
        before: { status: period.status },
        after: { status: 'CLOSED', forced: options.force },
      });

      await uow.publish({
        aggregateType: 'timesheet_period',
        aggregateId: periodId,
        eventType: 'timesheet.period.closed',
        payload: { period_id: periodId, company_id: period.companyId },
      });

      return { id: periodId, status: 'CLOSED' };
    });
  }

  /** เปิดงวดใหม่ — ต้องมีเหตุผลเสมอ (ADR-0009 REASON_REQUIRED_ACTIONS) */
  async reopen(periodId: string, reason: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const periods = await uow.tx
        .select()
        .from(schema.timesheetPeriods)
        .where(eq(schema.timesheetPeriods.id, periodId))
        .limit(1);
      const period = periods[0];
      if (period === undefined) throw AppError.notFound('timesheet period');
      if (period.status !== 'CLOSED') throw AppError.conflict('only a closed period can be reopened');

      const now = this.clock.now();
      await uow.tx
        .update(schema.timesheetPeriods)
        .set({
          status: 'REOPENED',
          reopenedAt: now,
          reopenedBy: this.requestContext.requirePrincipal().principalId,
          reopenReason: reason,
        })
        .where(eq(schema.timesheetPeriods.id, periodId));

      await uow.tx
        .update(schema.timesheets)
        .set({ status: 'DRAFT', updatedAt: now })
        .where(eq(schema.timesheets.periodId, periodId));

      await uow.audit({
        action: 'timesheet.period.reopen',
        resourceType: 'timesheet_period',
        resourceId: periodId,
        outcome: 'SUCCESS',
        companyId: period.companyId,
        reason,
        before: { status: 'CLOSED' },
        after: { status: 'REOPENED' },
      });

      return { id: periodId, status: 'REOPENED' };
    });
  }

  /** รายการงวด timesheet ทั้งหมดของ tenant — ใช้เป็นหน้าลิสต์ */
  async listPeriods(companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.timesheetPeriods)
        .where(companyId === undefined ? undefined : eq(schema.timesheetPeriods.companyId, companyId))
        .orderBy(desc(schema.timesheetPeriods.startsOn));

      return {
        items: rows.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          name: row.name,
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          status: row.status,
          closed_at: row.closedAt?.toISOString() ?? null,
          reopened_at: row.reopenedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  async listTimesheets(periodId: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.timesheets)
        .where(eq(schema.timesheets.periodId, periodId));

      return {
        items: rows.map((row) => ({
          id: row.id,
          employment_id: row.employmentId,
          status: row.status,
          scheduled_days: row.scheduledDays,
          worked_days: row.workedDays,
          worked_minutes: row.workedMinutes,
          paid_minutes: row.paidMinutes,
          late_minutes: row.lateMinutes,
          absence_minutes: row.absenceMinutes,
          early_out_minutes: row.earlyOutMinutes,
          paid_leave_minutes: row.paidLeaveMinutes,
          unpaid_leave_minutes: row.unpaidLeaveMinutes,
          ot_workday_minutes: row.otWorkdayMinutes,
          ot_rest_day_minutes: row.otRestDayMinutes,
          ot_holiday_minutes: row.otHolidayMinutes,
          blocking_exception_count: row.blockingExceptionCount,
        })),
      };
    });
  }
}
