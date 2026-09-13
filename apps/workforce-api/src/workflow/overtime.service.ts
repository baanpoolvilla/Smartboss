import { Inject, Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { AppError, uuidv7, type Clock } from '@workforce/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { CLOCK } from '../shared/tokens';
import { LeaveService } from './leave.service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ล่วงเวลา (spec §8.3)
 *
 * แยก planned / actual / eligible / approved ออกจากกันชัดเจน
 * ระบบเดิมมีแค่ตัวเลข minutes ที่ admin กรอกเอง จึงตรวจสอบไม่ได้ว่ามาจากไหน
 */
@Injectable()
export class OvertimeService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly requestContext: RequestContextService,
    private readonly leave: LeaveService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async submit(input: {
    employment_id: string;
    work_date: string;
    ot_category: 'WORKDAY' | 'REST_DAY' | 'PUBLIC_HOLIDAY';
    planned_minutes: number;
    reason: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const employments = await uow.tx
        .select()
        .from(schema.employments)
        .where(eq(schema.employments.id, input.employment_id))
        .limit(1);
      const employment = employments[0];
      if (employment === undefined) throw AppError.notFound('employment');

      const id = uuidv7();
      await uow.tx.insert(schema.overtimeRequests).values({
        id,
        tenantId: uow.tenantId,
        companyId: employment.companyId,
        employmentId: input.employment_id,
        workDate: input.work_date,
        otCategory: input.ot_category,
        plannedMinutes: input.planned_minutes,
        reason: input.reason,
        status: 'SUBMITTED',
        createdBy: this.requestContext.requirePrincipal().principalId,
      });

      await uow.audit({
        action: 'overtime.request.submit',
        resourceType: 'overtime_request',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: employment.companyId,
        after: {
          work_date: input.work_date,
          ot_category: input.ot_category,
          planned_minutes: input.planned_minutes,
        },
      });

      return { id, status: 'SUBMITTED' };
    });
  }

  async preApprove(requestId: string, reason: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const request = await this.load(uow.tx, requestId);
      if (request.status !== 'SUBMITTED') throw AppError.conflict('request is not submitted');

      const approverId = this.requestContext.requirePrincipal().principalId;
      if (request.createdBy === approverId) {
        throw AppError.forbidden('the approver must be different from the requester');
      }

      await uow.tx
        .update(schema.overtimeRequests)
        .set({ status: 'PRE_APPROVED', preApprovedBy: approverId, preApprovedAt: this.clock.now() })
        .where(eq(schema.overtimeRequests.id, requestId));

      await uow.audit({
        action: 'overtime.request.pre-approve',
        resourceType: 'overtime_request',
        resourceId: requestId,
        outcome: 'SUCCESS',
        companyId: request.companyId,
        reason,
        after: { status: 'PRE_APPROVED' },
      });

      return { id: requestId, status: 'PRE_APPROVED' };
    });
  }

  /**
   * อนุมัติขั้นสุดท้ายหลังทำงานจริง
   *
   * `eligible = min(planned, actual)` เป็นค่าเริ่มต้นตาม spec §8.3 — ผู้อนุมัติ
   * ลดลงได้แต่เพิ่มเกิน eligible ไม่ได้ เพื่อไม่ให้จ่าย OT ที่ไม่ได้ทำจริง
   */
  async finalApprove(
    requestId: string,
    input: { actual_minutes: number; approved_minutes: number | null; reason: string },
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const request = await this.load(uow.tx, requestId);
      if (request.status !== 'PRE_APPROVED' && request.status !== 'SUBMITTED') {
        throw AppError.conflict('request is not awaiting final approval');
      }

      const approverId = this.requestContext.requirePrincipal().principalId;
      if (request.createdBy === approverId) {
        throw AppError.forbidden('the approver must be different from the requester');
      }

      const eligible =
        request.plannedMinutes > 0
          ? Math.min(request.plannedMinutes, input.actual_minutes)
          : input.actual_minutes;
      const approved = input.approved_minutes ?? eligible;

      if (approved > eligible) {
        throw AppError.validation('approved_minutes must not exceed the eligible minutes', {
          meta: {
            eligible_minutes: eligible,
            planned_minutes: request.plannedMinutes,
            actual_minutes: input.actual_minutes,
          },
        });
      }

      await uow.tx
        .update(schema.overtimeRequests)
        .set({
          status: 'FINAL_APPROVED',
          actualMinutes: input.actual_minutes,
          eligibleMinutes: eligible,
          approvedMinutes: approved,
          finalApprovedBy: approverId,
          finalApprovedAt: this.clock.now(),
          decisionReason: input.reason,
        })
        .where(eq(schema.overtimeRequests.id, requestId));

      await uow.audit({
        action: 'overtime.request.final-approve',
        resourceType: 'overtime_request',
        resourceId: requestId,
        outcome: 'SUCCESS',
        companyId: request.companyId,
        reason: input.reason,
        after: {
          actual_minutes: input.actual_minutes,
          eligible_minutes: eligible,
          approved_minutes: approved,
        },
      });

      return {
        id: requestId,
        status: 'FINAL_APPROVED',
        eligible_minutes: eligible,
        approved_minutes: approved,
      };
    });
  }

  /**
   * อนุมัติ/ไม่อนุมัติ OT ที่ตรวจพบจากเวลาสแกน (ผลลงเวลาฉบับปัจจุบัน) ในขั้นเดียว
   *
   * ไม่มีคำขอล่วงหน้า — มาทำงานวันหยุดหรืออยู่ต่อหลังเลิกกะแล้วระบบเห็นเอง ผู้อนุมัติ
   * ยืนยันหรือลดนาทีได้แต่เกินที่ตรวจพบไม่ได้ และตัดสิน OT ของตัวเองไม่ได้
   *
   * ตัดสินได้ครั้งเดียวต่อคนต่อวัน — ใบลงเวลาอ่าน OT รายวันเป็นค่าเดียว
   * (timesheet.service otByDate) ถ้ามีหลายใบต่อวันจะนับไม่ครบ
   */
  async decideFromAttendance(input: {
    employment_id: string;
    work_date: string;
    decision: 'APPROVE' | 'REJECT';
    approved_minutes: number | null;
    reason: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const principal = this.requestContext.requirePrincipal();
      if (principal.employmentId === input.employment_id) {
        throw AppError.forbidden('you cannot decide your own overtime');
      }

      const results = await uow.tx
        .select()
        .from(schema.attendanceResults)
        .where(
          and(
            eq(schema.attendanceResults.employmentId, input.employment_id),
            eq(schema.attendanceResults.workDate, input.work_date),
            eq(schema.attendanceResults.isCurrent, true),
          ),
        )
        .limit(1);
      const result = results[0];
      if (result === undefined || result.otCandidateMinutes <= 0) {
        throw AppError.validation('no overtime was detected for this employee on this date', {
          meta: { employment_id: input.employment_id, work_date: input.work_date },
        });
      }

      const decided = await uow.tx
        .select({ id: schema.overtimeRequests.id })
        .from(schema.overtimeRequests)
        .where(
          and(
            eq(schema.overtimeRequests.employmentId, input.employment_id),
            eq(schema.overtimeRequests.workDate, input.work_date),
            inArray(schema.overtimeRequests.status, ['FINAL_APPROVED', 'REJECTED']),
          ),
        )
        .limit(1);
      if (decided.length > 0) {
        throw AppError.conflict('overtime for this date has already been decided');
      }

      const detected = result.otCandidateMinutes;
      const approve = input.decision === 'APPROVE';
      const approved = approve ? (input.approved_minutes ?? detected) : 0;
      if (approved > detected) {
        throw AppError.validation('approved_minutes must not exceed the detected overtime', {
          meta: { detected_minutes: detected, approved_minutes: approved },
        });
      }

      const dayOff = (
        await this.leave.dayOffDates(uow.tx, input.employment_id, input.work_date, input.work_date)
      ).has(input.work_date);
      const category = result.isHoliday
        ? 'PUBLIC_HOLIDAY'
        : result.isRestDay || dayOff
          ? 'REST_DAY'
          : 'WORKDAY';

      const id = uuidv7();
      const status = approve ? 'FINAL_APPROVED' : 'REJECTED';
      await uow.tx.insert(schema.overtimeRequests).values({
        id,
        tenantId: uow.tenantId,
        companyId: result.companyId,
        employmentId: input.employment_id,
        workDate: input.work_date,
        otCategory: category,
        plannedMinutes: 0,
        actualMinutes: detected,
        eligibleMinutes: detected,
        approvedMinutes: approved,
        reason: 'ตรวจพบจากเวลาสแกน',
        status,
        finalApprovedBy: principal.principalId,
        finalApprovedAt: this.clock.now(),
        decisionReason: input.reason,
        createdBy: principal.principalId,
      });

      await uow.audit({
        action: 'overtime.request.decide-from-attendance',
        resourceType: 'overtime_request',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: result.companyId,
        reason: input.reason,
        after: {
          work_date: input.work_date,
          ot_category: category,
          detected_minutes: detected,
          approved_minutes: approved,
          status,
        },
      });

      return { id, status, ot_category: category, detected_minutes: detected, approved_minutes: approved };
    });
  }

  async list(query: {
    companyId?: string;
    employmentId?: string;
    status?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    for (const [name, value] of [
      ['from', query.from],
      ['to', query.to],
    ] as const) {
      if (value !== undefined && !ISO_DATE.test(value)) {
        throw AppError.validation(`${name} must be an ISO date (YYYY-MM-DD)`, {
          meta: { [name]: value },
        });
      }
    }

    return this.uow.run(async (uow) => {
      const conditions = [];
      if (query.companyId !== undefined)
        conditions.push(eq(schema.overtimeRequests.companyId, query.companyId));
      if (query.employmentId !== undefined)
        conditions.push(eq(schema.overtimeRequests.employmentId, query.employmentId));
      if (query.status !== undefined)
        conditions.push(eq(schema.overtimeRequests.status, query.status));
      if (query.from !== undefined)
        conditions.push(sql`${schema.overtimeRequests.workDate} >= ${query.from}`);
      if (query.to !== undefined)
        conditions.push(sql`${schema.overtimeRequests.workDate} <= ${query.to}`);

      const rows = await uow.tx
        .select()
        .from(schema.overtimeRequests)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.overtimeRequests.workDate))
        .limit(200);

      return {
        items: rows.map((row) => ({
          id: row.id,
          employment_id: row.employmentId,
          work_date: row.workDate,
          ot_category: row.otCategory,
          planned_minutes: row.plannedMinutes,
          actual_minutes: row.actualMinutes,
          eligible_minutes: row.eligibleMinutes,
          approved_minutes: row.approvedMinutes,
          status: row.status,
          reason: row.reason,
          decision_reason: row.decisionReason,
          final_approved_at: row.finalApprovedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  private async load(
    tx: Tx,
    requestId: string,
  ): Promise<typeof schema.overtimeRequests.$inferSelect> {
    const rows = await tx
      .select()
      .from(schema.overtimeRequests)
      .where(eq(schema.overtimeRequests.id, requestId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) throw AppError.notFound('overtime request');
    return row;
  }
}
