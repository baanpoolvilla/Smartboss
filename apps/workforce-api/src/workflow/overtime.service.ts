import { Inject, Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { AppError, uuidv7, type Clock } from '@workforce/domain';
import { and, eq } from 'drizzle-orm';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { CLOCK } from '../shared/tokens';

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

  async list(query: {
    companyId?: string;
    employmentId?: string;
    status?: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const conditions = [];
      if (query.companyId !== undefined)
        conditions.push(eq(schema.overtimeRequests.companyId, query.companyId));
      if (query.employmentId !== undefined)
        conditions.push(eq(schema.overtimeRequests.employmentId, query.employmentId));
      if (query.status !== undefined)
        conditions.push(eq(schema.overtimeRequests.status, query.status));

      const rows = await uow.tx
        .select()
        .from(schema.overtimeRequests)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
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
