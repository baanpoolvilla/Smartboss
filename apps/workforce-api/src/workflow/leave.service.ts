import { Inject, Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { AppError, LocalDate, uuidv7, type Clock } from '@workforce/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { CLOCK } from '../shared/tokens';

export interface LeaveBalance {
  leave_type_id: string;
  period_year: number;
  granted_minutes: number;
  reserved_minutes: number;
  consumed_minutes: number;
  available_minutes: number;
}

/**
 * การลา + สมุดบัญชีสิทธิ์การลาแบบ append-only (spec §8.2)
 *
 * ยอดคงเหลือคือผลรวมของรายการใน ledger ไม่ใช่ตัวเลขที่ถูกเขียนทับ
 * จึงตอบได้เสมอว่าสิทธิ์หายไปกับใบไหนและเมื่อไร
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly requestContext: RequestContextService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createLeaveType(input: {
    company_id: string;
    code: string;
    name: string;
    paid: boolean;
    unit: 'DAY' | 'HALF_DAY' | 'HOUR';
    quota_minutes_per_year: number;
    advance_notice_days: number;
    attachment_required: boolean;
    allow_negative: boolean;
    auto_approve: boolean;
    monthly_quota_days: number;
    effective_from: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const id = uuidv7();
      await uow.tx.insert(schema.leaveTypes).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        name: input.name,
        paid: input.paid,
        unit: input.unit,
        quotaMinutesPerYear: input.quota_minutes_per_year,
        autoApprove: input.auto_approve,
        monthlyQuotaDays: input.monthly_quota_days,
        advanceNoticeDays: input.advance_notice_days,
        attachmentRequired: input.attachment_required,
        allowNegative: input.allow_negative,
        effectiveFrom: input.effective_from,
      });

      await uow.audit({
        action: 'leave.type.create',
        resourceType: 'leave_type',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { code: input.code, paid: input.paid, unit: input.unit },
      });

      return { id, code: input.code };
    });
  }

  /** ให้สิทธิ์ต้นงวด — บันทึกเป็นรายการ ไม่ใช่ตั้งค่ายอด */
  async grantOpeningBalance(input: {
    employment_id: string;
    leave_type_id: string;
    period_year: number;
    minutes: number;
    reason: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const id = uuidv7();
      await uow.tx.insert(schema.leaveBalanceLedger).values({
        id,
        tenantId: uow.tenantId,
        employmentId: input.employment_id,
        leaveTypeId: input.leave_type_id,
        entryType: 'OPENING',
        minutes: input.minutes,
        effectiveOn: `${String(input.period_year)}-01-01`,
        periodYear: input.period_year,
        reason: input.reason,
        createdBy: this.requestContext.requirePrincipal().principalId,
      });

      await uow.audit({
        action: 'leave.balance.grant',
        resourceType: 'leave_balance_ledger',
        resourceId: id,
        outcome: 'SUCCESS',
        after: { minutes: input.minutes, period_year: input.period_year },
      });

      return { id, minutes: input.minutes };
    });
  }

  async getBalance(employmentId: string, periodYear: number): Promise<{ items: LeaveBalance[] }> {
    return this.uow.run(async (uow) => {
      const rows = await this.aggregateBalance(uow.tx, employmentId, periodYear);
      return { items: rows };
    });
  }

  private async aggregateBalance(
    tx: Tx,
    employmentId: string,
    periodYear: number,
    leaveTypeId?: string,
  ): Promise<LeaveBalance[]> {
    const conditions = [
      eq(schema.leaveBalanceLedger.employmentId, employmentId),
      eq(schema.leaveBalanceLedger.periodYear, periodYear),
    ];
    if (leaveTypeId !== undefined) {
      conditions.push(eq(schema.leaveBalanceLedger.leaveTypeId, leaveTypeId));
    }

    const entries = await tx
      .select()
      .from(schema.leaveBalanceLedger)
      .where(and(...conditions));

    const byType = new Map<string, LeaveBalance>();
    for (const entry of entries) {
      let balance = byType.get(entry.leaveTypeId);
      if (balance === undefined) {
        balance = {
          leave_type_id: entry.leaveTypeId,
          period_year: periodYear,
          granted_minutes: 0,
          reserved_minutes: 0,
          consumed_minutes: 0,
          available_minutes: 0,
        };
        byType.set(entry.leaveTypeId, balance);
      }

      switch (entry.entryType) {
        case 'OPENING':
        case 'ACCRUAL':
        case 'ADJUST':
          balance.granted_minutes += entry.minutes;
          break;
        case 'RESERVE':
          balance.reserved_minutes += -entry.minutes;
          break;
        case 'RELEASE':
          balance.reserved_minutes -= entry.minutes;
          break;
        case 'CONSUME':
          balance.consumed_minutes += -entry.minutes;
          break;
        case 'EXPIRE':
          balance.granted_minutes += entry.minutes;
          break;
        case 'REVERSAL':
          // รายการกลับรายการชดเชยผลของรายการเดิมที่มันอ้างถึง
          balance.granted_minutes += entry.minutes;
          break;
      }
    }

    for (const balance of byType.values()) {
      balance.available_minutes =
        balance.granted_minutes - balance.reserved_minutes - balance.consumed_minutes;
    }

    return [...byType.values()];
  }

  /**
   * ยื่นใบลา — จองสิทธิ์ทันที (RESERVE) ยังไม่ตัด (CONSUME)
   *
   * แยกจองกับตัดออกจากกันเพื่อให้ยกเลิกใบลาที่ยังไม่อนุมัติแล้วคืนสิทธิ์ได้
   * โดยไม่ต้องแก้ยอดย้อนหลัง
   */
  async submitRequest(input: {
    employment_id: string;
    leave_type_id: string;
    starts_on: string;
    ends_on: string;
    total_minutes: number;
    half_day_start: boolean;
    half_day_end: boolean;
    reason: string;
    swap_from_date?: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const employments = await uow.tx
        .select()
        .from(schema.employments)
        .where(eq(schema.employments.id, input.employment_id))
        .limit(1);
      const employment = employments[0];
      if (employment === undefined) throw AppError.notFound('employment');

      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.id, input.leave_type_id))
        .limit(1);
      const leaveType = types[0];
      if (leaveType === undefined) throw AppError.notFound('leave type');

      // สลับวันหยุด — ใบเดิมต้องยังมีผลอยู่ตอนนี้ ไม่งั้นไม่รู้จะสลับจากอะไร
      let swapFromRequest: typeof schema.leaveRequests.$inferSelect | undefined;
      if (input.swap_from_date !== undefined) {
        const olds = await uow.tx
          .select()
          .from(schema.leaveRequests)
          .where(
            and(
              eq(schema.leaveRequests.employmentId, input.employment_id),
              eq(schema.leaveRequests.leaveTypeId, input.leave_type_id),
              eq(schema.leaveRequests.startsOn, input.swap_from_date),
              inArray(schema.leaveRequests.status, ['SUBMITTED', 'APPROVED']),
            ),
          )
          .limit(1);
        swapFromRequest = olds[0];
        if (swapFromRequest === undefined) {
          throw AppError.validation('the day off to swap from was not found or already released');
        }
      }

      const startsOn = LocalDate.parse(input.starts_on);
      const endsOn = LocalDate.parse(input.ends_on);
      if (endsOn.isBefore(startsOn)) throw AppError.validation('ends_on must not be before starts_on');

      if (leaveType.advanceNoticeDays > 0) {
        const today = LocalDate.fromInstant(this.clock.now(), employment.timeZone);
        if (today.daysUntil(startsOn) < leaveType.advanceNoticeDays) {
          throw AppError.validation(
            `this leave type requires ${String(leaveType.advanceNoticeDays)} days of notice`,
          );
        }
      }

      const periodYear = startsOn.year;
      if (!leaveType.allowNegative) {
        const balances = await this.aggregateBalance(
          uow.tx,
          input.employment_id,
          periodYear,
          input.leave_type_id,
        );
        const available = balances[0]?.available_minutes ?? 0;
        if (available < input.total_minutes) {
          throw AppError.validation('insufficient leave balance', {
            meta: { available_minutes: available, requested_minutes: input.total_minutes },
          });
        }
      }

      /*
       * โควตารายเดือน — quota_minutes_per_year คุมรายเดือนไม่ได้
       * ใส่ 72 ชม./ปี ก็ยังลาหมดในเดือนเดียวได้ ซึ่งไม่ใช่สิ่งที่ตั้งใจเมื่อกฎคือ
       * "หยุดได้ 6 วันต่อเดือน"
       *
       * นับทั้ง SUBMITTED และ APPROVED — ใบที่รออนุมัติกันโควตาไว้แล้ว
       * ไม่งั้นจะส่งค้างไว้เกินโควตาแล้วรอให้อนุมัติทีเดียวทั้งหมด
       */
      if (leaveType.monthlyQuotaDays > 0) {
        const monthStart = startsOn.firstDayOfMonth().toString();
        const monthEnd = startsOn.lastDayOfMonth().toString();

        const existing = await uow.tx
          .select({ id: schema.leaveRequests.id, totalMinutes: schema.leaveRequests.totalMinutes })
          .from(schema.leaveRequests)
          .where(
            and(
              eq(schema.leaveRequests.employmentId, input.employment_id),
              eq(schema.leaveRequests.leaveTypeId, input.leave_type_id),
              inArray(schema.leaveRequests.status, ['SUBMITTED', 'APPROVED']),
              sql`${schema.leaveRequests.startsOn} >= ${monthStart}`,
              sql`${schema.leaveRequests.startsOn} <= ${monthEnd}`,
            ),
          );

        // สลับวันหยุดไม่ได้ขอเพิ่ม — ตัดใบเดิมที่กำลังจะถูกยกเลิกออกจากยอดที่ใช้ไปแล้ว
        // ไม่งั้นคนที่ใช้โควตาเต็มเดือนอยู่แล้วจะสลับวันไม่ได้ทั้งที่ไม่ได้ขอเพิ่มวัน
        const usedDays =
          existing
            .filter((row) => row.id !== swapFromRequest?.id)
            .reduce((sum, row) => sum + row.totalMinutes, 0) / 480;
        const requestedDays = input.total_minutes / 480;
        if (usedDays + requestedDays > leaveType.monthlyQuotaDays) {
          throw AppError.validation('monthly quota exceeded', {
            meta: {
              monthly_quota_days: leaveType.monthlyQuotaDays,
              used_days: usedDays,
              requested_days: requestedDays,
            },
          });
        }
      }

      const requestId = uuidv7();
      await uow.tx.insert(schema.leaveRequests).values({
        id: requestId,
        tenantId: uow.tenantId,
        companyId: employment.companyId,
        employmentId: input.employment_id,
        leaveTypeId: input.leave_type_id,
        startsOn: input.starts_on,
        endsOn: input.ends_on,
        totalMinutes: input.total_minutes,
        paidMinutes: leaveType.paid ? input.total_minutes : 0,
        unpaidMinutes: leaveType.paid ? 0 : input.total_minutes,
        halfDayStart: input.half_day_start,
        halfDayEnd: input.half_day_end,
        reason: input.reason,
        swapFromDate: input.swap_from_date ?? null,
        // สิทธิ์ที่ไม่ใช่คำขอ (เช่นวันหยุดประจำเดือน) อนุมัติทันที ไม่เข้าคิว
        // ยกเว้นคำขอสลับ — ต้องรออนุมัติเสมอเพราะกระทบวันเดิมที่คนอื่นวางแผนไว้แล้ว
        status: swapFromRequest !== undefined ? 'SUBMITTED' : leaveType.autoApprove ? 'APPROVED' : 'SUBMITTED',
        submittedAt: this.clock.now(),
        createdBy: this.requestContext.requirePrincipal().principalId,
      });

      await uow.tx.insert(schema.leaveBalanceLedger).values({
        id: uuidv7(),
        tenantId: uow.tenantId,
        employmentId: input.employment_id,
        leaveTypeId: input.leave_type_id,
        entryType: 'RESERVE',
        minutes: -input.total_minutes,
        effectiveOn: input.starts_on,
        periodYear,
        leaveRequestId: requestId,
        reason: 'reserved on submission',
      });

      // อนุมัติทันที = ต้องปิดบัญชีให้ครบเหมือนเส้นทางที่ผ่านการกดอนุมัติจริง
      //
      // เดิมเส้นทางนี้ตั้งสถานะเป็น APPROVED แต่ลงบัญชีแค่ RESERVE ทำให้ใบลาที่
      // อนุมัติอัตโนมัติค้างอยู่ในช่อง "จองไว้" ตลอดกาล ไม่เคยย้ายไป "ใช้ไปแล้ว"
      // ยอดคงเหลือยังถูก (ทั้งสองช่องถูกหักออกจากสิทธิ์เหมือนกัน) แต่การแยกช่อง
      // ในรายงานผิด และโค้ดอื่นที่เชื่อว่า "APPROVED แปลว่าตัดสิทธิ์แล้ว" ก็คิดผิดตาม
      // (เช่นการสลับวันหยุด ที่กลับรายการผิดชนิดจนยอดจองไม่ถูกคืน)
      //
      // ลงคู่ RELEASE + CONSUME เหมือน decideRequest ทุกประการ เพื่อให้ได้
      // ข้อกำหนดที่ยึดถือได้ทั้งระบบ: สถานะ APPROVED ⇒ ปลดจองแล้ว และตัดสิทธิ์แล้ว
      if (swapFromRequest === undefined && leaveType.autoApprove) {
        await uow.tx.insert(schema.leaveBalanceLedger).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          employmentId: input.employment_id,
          leaveTypeId: input.leave_type_id,
          entryType: 'RELEASE',
          minutes: input.total_minutes,
          effectiveOn: input.starts_on,
          periodYear,
          leaveRequestId: requestId,
          reason: 'release on auto-approve',
        });
        await uow.tx.insert(schema.leaveBalanceLedger).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          employmentId: input.employment_id,
          leaveTypeId: input.leave_type_id,
          entryType: 'CONSUME',
          minutes: -input.total_minutes,
          effectiveOn: input.starts_on,
          periodYear,
          leaveRequestId: requestId,
          reason: 'consumed on auto-approve',
        });
      }

      await uow.audit({
        action: 'leave.request.submit',
        resourceType: 'leave_request',
        resourceId: requestId,
        outcome: 'SUCCESS',
        companyId: employment.companyId,
        after: {
          leave_type_id: input.leave_type_id,
          starts_on: input.starts_on,
          total_minutes: input.total_minutes,
        },
      });

      return {
        id: requestId,
        status: swapFromRequest !== undefined ? 'SUBMITTED' : leaveType.autoApprove ? 'APPROVED' : 'SUBMITTED',
      };
    });
  }

  async decideRequest(
    requestId: string,
    input: { outcome: 'APPROVED' | 'REJECTED'; reason: string },
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const requests = await uow.tx
        .select()
        .from(schema.leaveRequests)
        .where(eq(schema.leaveRequests.id, requestId))
        .limit(1);
      const request = requests[0];
      if (request === undefined) throw AppError.notFound('leave request');
      if (request.status !== 'SUBMITTED') throw AppError.conflict('leave request is not submitted');

      const approverId = this.requestContext.requirePrincipal().principalId;
      if (request.createdBy === approverId) {
        throw AppError.forbidden('the approver must be different from the requester');
      }

      const periodYear = LocalDate.parse(request.startsOn).year;
      const now = this.clock.now();

      await uow.tx
        .update(schema.leaveRequests)
        .set({
          status: input.outcome,
          decidedAt: now,
          decidedBy: approverId,
          decisionReason: input.reason,
        })
        .where(eq(schema.leaveRequests.id, requestId));

      // ปลดการจองเสมอ แล้วตัดสิทธิ์จริงเฉพาะเมื่ออนุมัติ
      await uow.tx.insert(schema.leaveBalanceLedger).values({
        id: uuidv7(),
        tenantId: uow.tenantId,
        employmentId: request.employmentId,
        leaveTypeId: request.leaveTypeId,
        entryType: 'RELEASE',
        minutes: request.totalMinutes,
        effectiveOn: request.startsOn,
        periodYear,
        leaveRequestId: requestId,
        reason: `release on ${input.outcome.toLowerCase()}`,
      });

      if (input.outcome === 'APPROVED') {
        await uow.tx.insert(schema.leaveBalanceLedger).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          employmentId: request.employmentId,
          leaveTypeId: request.leaveTypeId,
          entryType: 'CONSUME',
          minutes: -request.totalMinutes,
          effectiveOn: request.startsOn,
          periodYear,
          leaveRequestId: requestId,
          reason: 'consumed on approval',
        });
      }

      // สลับวันหยุด — อนุมัติแล้วต้องยกเลิกใบเดิมพร้อมกัน ไม่งั้นจะหยุดได้สองวัน
      // ถ้าไม่อนุมัติไม่ต้องทำอะไรกับใบเดิม (มันยังไม่เคยถูกแตะตั้งแต่ยื่นคำขอสลับ)
      if (input.outcome === 'APPROVED' && request.swapFromDate !== null) {
        const olds = await uow.tx
          .select()
          .from(schema.leaveRequests)
          .where(
            and(
              eq(schema.leaveRequests.employmentId, request.employmentId),
              eq(schema.leaveRequests.leaveTypeId, request.leaveTypeId),
              eq(schema.leaveRequests.startsOn, request.swapFromDate),
              inArray(schema.leaveRequests.status, ['SUBMITTED', 'APPROVED']),
            ),
          )
          .limit(1);
        const oldRequest = olds[0];
        // ถ้าใบเดิมหายไปแล้ว (เช่นถูกยกเลิกเองระหว่างรออนุมัติ) ไม่ต้องทำอะไรต่อ
        if (oldRequest !== undefined) {
          const oldPeriodYear = LocalDate.parse(oldRequest.startsOn).year;
          // ใบเดิมอนุมัติแล้ว = ตัดสิทธิ์ไปแล้ว ต้อง "ยกเลิกการตัด" ไม่ใช่โปะคืน
          // เข้าโควตา — การสลับไม่ได้ทำให้ได้วันเพิ่ม แค่ย้ายวันเท่านั้น ถ้าใช้
          // REVERSAL (ซึ่งบวกเข้า granted) ยอด "สิทธิ์ที่ได้รับ" จะพองขึ้นทุกครั้ง
          // ที่มีคนสลับวัน และยอด "ใช้ไปแล้ว" จะนับซ้ำทั้งวันเก่าและวันใหม่
          // ยังไม่อนุมัติ = ยังแค่จองไว้ ปลดจองด้วย RELEASE ตามเดิม
          await uow.tx.insert(schema.leaveBalanceLedger).values({
            id: uuidv7(),
            tenantId: uow.tenantId,
            employmentId: oldRequest.employmentId,
            leaveTypeId: oldRequest.leaveTypeId,
            entryType: oldRequest.status === 'APPROVED' ? 'CONSUME' : 'RELEASE',
            minutes: oldRequest.totalMinutes,
            effectiveOn: oldRequest.startsOn,
            periodYear: oldPeriodYear,
            leaveRequestId: oldRequest.id,
            reason: `swapped to ${request.startsOn}`,
          });
          await uow.tx
            .update(schema.leaveRequests)
            .set({
              status: 'CANCELLED',
              decisionReason: `swapped to ${request.startsOn}`,
              decidedAt: now,
              decidedBy: approverId,
            })
            .where(eq(schema.leaveRequests.id, oldRequest.id));
        }
      }

      await uow.audit({
        action: 'leave.request.decide',
        resourceType: 'leave_request',
        resourceId: requestId,
        outcome: 'SUCCESS',
        companyId: request.companyId,
        reason: input.reason,
        before: { status: request.status },
        after: { status: input.outcome },
      });

      return { id: requestId, status: input.outcome };
    });
  }

  /**
   * ใบลาของตัวเอง — ใช้สิทธิ์พื้นฐาน workforce.leave.request เดียวกับตอนขอลา
   * ไม่ต้องมี workforce.leave.manage (ตัวนั้นเปิดให้เห็นของทุกคนในบริษัท ซึ่ง
   * เกินความจำเป็นแค่จะดู "ของฉันมีอะไรบ้าง" — spec เดียวกับ payslip.read.self)
   */
  async listMyRequests(query: {
    status?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    const employmentId = this.requestContext.requirePrincipal().employmentId;
    if (employmentId === null) {
      throw AppError.validation('this account is not linked to an employment record');
    }
    return this.listRequests({ ...query, employmentId });
  }

  /**
   * ยกเลิกใบลาที่อนุมัติแล้ว — คืนสิทธิ์ด้วยรายการ REVERSAL ไม่ลบรายการเดิม
   *
   * ยกเลิกของตัวเองได้เสมอ (ลงผิดวัน/เปลี่ยนใจ) ส่วนของคนอื่นต้องมี
   * workforce.leave.approve — เดิมจุดนี้ไม่มีการตรวจความเป็นเจ้าของเลย
   * ใครก็ตามที่มีแค่สิทธิ์ขอลาพื้นฐาน (ทุกคนมี) ยกเลิกใบของคนอื่นได้หมด
   * แค่รู้ requestId (เจอระหว่างทำหน้าจอให้พนักงานยกเลิกใบของตัวเอง)
   */
  async cancelRequest(requestId: string, reason: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const requests = await uow.tx
        .select()
        .from(schema.leaveRequests)
        .where(eq(schema.leaveRequests.id, requestId))
        .limit(1);
      const request = requests[0];
      if (request === undefined) throw AppError.notFound('leave request');
      if (request.status === 'CANCELLED') throw AppError.conflict('already cancelled');

      const principal = this.requestContext.requirePrincipal();
      const isOwn = principal.employmentId !== null && principal.employmentId === request.employmentId;
      if (!isOwn && !principal.permissions.has('workforce.leave.approve')) {
        throw AppError.forbidden('cannot cancel another employment\'s leave request');
      }

      const periodYear = LocalDate.parse(request.startsOn).year;

      if (request.status === 'APPROVED') {
        await uow.tx.insert(schema.leaveBalanceLedger).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          employmentId: request.employmentId,
          leaveTypeId: request.leaveTypeId,
          entryType: 'REVERSAL',
          minutes: request.totalMinutes,
          effectiveOn: request.startsOn,
          periodYear,
          leaveRequestId: requestId,
          reason,
        });
      } else if (request.status === 'SUBMITTED') {
        await uow.tx.insert(schema.leaveBalanceLedger).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          employmentId: request.employmentId,
          leaveTypeId: request.leaveTypeId,
          entryType: 'RELEASE',
          minutes: request.totalMinutes,
          effectiveOn: request.startsOn,
          periodYear,
          leaveRequestId: requestId,
          reason,
        });
      }

      await uow.tx
        .update(schema.leaveRequests)
        .set({ status: 'CANCELLED', decisionReason: reason, decidedAt: this.clock.now() })
        .where(eq(schema.leaveRequests.id, requestId));

      await uow.audit({
        action: 'leave.request.cancel',
        resourceType: 'leave_request',
        resourceId: requestId,
        outcome: 'SUCCESS',
        companyId: request.companyId,
        reason,
        before: { status: request.status },
        after: { status: 'CANCELLED' },
      });

      return { id: requestId, status: 'CANCELLED' };
    });
  }

  /** วันลาที่อนุมัติแล้วในช่วง — attendance engine และ timesheet ใช้ */
  async approvedMinutesByDate(
    tx: Tx,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<Map<string, { paid: number; unpaid: number }>> {
    const rows = await tx
      .select()
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.employmentId, employmentId),
          eq(schema.leaveRequests.status, 'APPROVED'),
          sql`${schema.leaveRequests.endsOn} >= ${from}`,
          sql`${schema.leaveRequests.startsOn} <= ${to}`,
        ),
      );

    const byDate = new Map<string, { paid: number; unpaid: number }>();
    for (const row of rows) {
      const start = LocalDate.parse(row.startsOn);
      const end = LocalDate.parse(row.endsOn);
      const days = start.daysUntil(end) + 1;
      // กระจายนาทีเท่า ๆ กันข้ามวัน; ครึ่งวันถูกสะท้อนใน total_minutes อยู่แล้ว
      const paidPerDay = Math.round(row.paidMinutes / days);
      const unpaidPerDay = Math.round(row.unpaidMinutes / days);

      for (let offset = 0; offset < days; offset += 1) {
        const key = start.plusDays(offset).toString();
        if (key < from || key > to) continue;
        const current = byDate.get(key) ?? { paid: 0, unpaid: 0 };
        current.paid += paidPerDay;
        current.unpaid += unpaidPerDay;
        byDate.set(key, current);
      }
    }

    return byDate;
  }

  /**
   * รายการคำขอลาตามช่วงวัน — ใช้สร้างปฏิทินรวมของทีม
   *
   * ปฏิทินในโมดูลรายงานและงานเคยเก็บการลาของตัวเอง ทำให้มีข้อมูลการลาสองชุด
   * ที่ไม่ตรงกัน และเงินเดือนคำนวณจากชุดของ workforce เท่านั้น — endpoint นี้
   * ทำให้ปฏิทินอ่านจากแหล่งเดียวกับที่ใช้คิดเงิน
   *
   * คืนเฉพาะสิ่งที่ปฏิทินต้องใช้ ไม่มีเหตุผลการลาหรือไฟล์แนบ (เป็นข้อมูลส่วนตัว)
   */
  /**
   * ประเภทการลาที่ใช้ได้
   *
   * เดิมมีแต่ POST — สร้างประเภทการลาไปแล้วไม่มีทางอ่านกลับ พนักงานจึงเลือก
   * ประเภทตอนขอลาไม่ได้เลย ซึ่งเท่ากับระบบลาใช้งานจริงไม่ได้ทั้งระบบ
   */
  async listTypes(companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(companyId === undefined ? undefined : eq(schema.leaveTypes.companyId, companyId))
        .limit(200);

      return {
        items: rows.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          code: row.code,
          name: row.name,
          paid: row.paid,
          unit: row.unit,
          quota_minutes_per_year: row.quotaMinutesPerYear,
          auto_approve: row.autoApprove,
          monthly_quota_days: row.monthlyQuotaDays,
        })),
      };
    });
  }

  /**
   * ปฏิทินวันหยุดรวมของทีม — ใครหยุดวันไหนบ้าง
   *
   * แยกจาก listRequests เพราะสิทธิ์คนละชั้น: listRequests ต้องมี
   * workforce.leave.manage ซึ่ง role EMPLOYEE ไม่มี ⇒ พนักงานจะมองไม่เห็น
   * แม้แต่วันหยุดของตัวเอง แต่ทั้งทีมต้องเห็นว่าใครหยุดวันไหนถึงจะวางแผนงานได้
   *
   * ⚠ คืนเฉพาะ ชื่อ + ช่วงวัน + สถานะ — **ไม่คืนเหตุผลและประเภทการลา**
   * เพราะ "ลาป่วย" กับเหตุผลเป็นข้อมูลสุขภาพ/ส่วนตัวที่เพื่อนร่วมงานไม่ต้องรู้
   * คนที่ต้องเห็นรายละเอียดคือผู้อนุมัติ ซึ่งใช้ listRequests อยู่แล้ว
   */
  async listCalendar(query: { from: string; to: string }): Promise<{
    items: Record<string, unknown>[];
  }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select({
          id: schema.leaveRequests.id,
          employmentId: schema.leaveRequests.employmentId,
          startsOn: schema.leaveRequests.startsOn,
          endsOn: schema.leaveRequests.endsOn,
          status: schema.leaveRequests.status,
          employeeCode: schema.employments.employeeCode,
          firstName: schema.people.firstName,
          lastName: schema.people.lastName,
          preferredName: schema.people.preferredName,
        })
        .from(schema.leaveRequests)
        .innerJoin(
          schema.employments,
          eq(schema.employments.id, schema.leaveRequests.employmentId),
        )
        .innerJoin(schema.people, eq(schema.people.id, schema.employments.personId))
        .where(
          and(
            // ทับซ้อนช่วง ไม่ใช่อยู่ในช่วงทั้งก้อน — การลาคร่อมเดือนต้องขึ้นทั้งสองเดือน
            sql`${schema.leaveRequests.startsOn} <= ${query.to}`,
            sql`${schema.leaveRequests.endsOn} >= ${query.from}`,
            // ใบที่เพิ่งส่งมีสถานะ SUBMITTED ไม่ใช่ PENDING (ดู submitRequest)
            // กรองผิดชื่อคือปฏิทินว่างเปล่าทั้งที่มีคนขอลาแล้ว
            inArray(schema.leaveRequests.status, ['SUBMITTED', 'APPROVED']),
          ),
        )
        .limit(1000);

      return {
        items: rows.map((row) => ({
          id: row.id,
          employment_id: row.employmentId,
          display_name:
            row.preferredName.trim() === ''
              ? `${row.firstName} ${row.lastName}`.trim()
              : row.preferredName,
          employee_code: row.employeeCode,
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          // ฝั่งหน้าจอสนใจแค่ "รออนุมัติ" กับ "อนุมัติแล้ว" — ไม่ต้องรู้ชื่อสถานะภายใน
          status: row.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
        })),
      };
    });
  }

  async listRequests(query: {
    companyId?: string;
    employmentId?: string;
    status?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const conditions = [];
      if (query.companyId !== undefined)
        conditions.push(eq(schema.leaveRequests.companyId, query.companyId));
      if (query.employmentId !== undefined)
        conditions.push(eq(schema.leaveRequests.employmentId, query.employmentId));
      if (query.status !== undefined)
        conditions.push(eq(schema.leaveRequests.status, query.status));
      // ทับซ้อนช่วงที่ขอ ไม่ใช่อยู่ในช่วงทั้งก้อน — การลาคร่อมเดือนต้องขึ้นทั้งสองเดือน
      if (query.to !== undefined)
        conditions.push(sql`${schema.leaveRequests.startsOn} <= ${query.to}`);
      if (query.from !== undefined)
        conditions.push(sql`${schema.leaveRequests.endsOn} >= ${query.from}`);

      const rows = await uow.tx
        .select()
        .from(schema.leaveRequests)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(500);

      return {
        items: rows.map((row) => ({
          id: row.id,
          employment_id: row.employmentId,
          leave_type_id: row.leaveTypeId,
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          total_minutes: row.totalMinutes,
          half_day_start: row.halfDayStart,
          half_day_end: row.halfDayEnd,
          status: row.status,
        })),
      };
    });
  }

}
