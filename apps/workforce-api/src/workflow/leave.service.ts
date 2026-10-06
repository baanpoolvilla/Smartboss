import { Inject, Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { AppError, LocalDate, uuidv7, type Clock } from '@workforce/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { CLOCK } from '../shared/tokens';
import {
  holidayAvailability,
  monthIndex,
  monthOfIndex,
  type HolidayBucket,
  type HolidayLedgerInput,
} from './holiday-accrual';

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
/**
 * คำขอสลับวันที่ยังรออนุมัติ — ใบเดิมยังมีผลและถูกนับอยู่แล้ว อนุมัติเมื่อไรใบเดิมถูกยกเลิกพร้อมกัน
 * นับใบนี้ด้วยจะกลายเป็นใช้สิทธิ์ Holiday สองวันจากวันหยุดวันเดียว (ได้ 2 วันแต่ขึ้นว่าใช้ไป 3)
 */
function isPendingSwap(request: { status: string; swapFromDate: string | null }): boolean {
  return request.status === 'SUBMITTED' && request.swapFromDate !== null;
}

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
    show_on_calendar: boolean;
    requires_reports: boolean;
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
        showOnCalendar: input.show_on_calendar,
        requiresReports: input.requires_reports,
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

  /** แก้ชื่อประเภทลาที่มีอยู่แล้ว — ดูคอมเมนต์บน endpoint ใน workflow.controller.ts */
  async renameLeaveType(leaveTypeId: string, name: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.id, leaveTypeId))
        .limit(1);
      const type = types[0];
      if (type === undefined) throw AppError.notFound('leave type');

      await uow.tx
        .update(schema.leaveTypes)
        .set({ name })
        .where(eq(schema.leaveTypes.id, leaveTypeId));

      await uow.audit({
        action: 'leave.type.rename',
        resourceType: 'leave_type',
        resourceId: leaveTypeId,
        outcome: 'SUCCESS',
        companyId: type.companyId,
        before: { name: type.name },
        after: { name },
      });

      return { id: leaveTypeId, name };
    });
  }

  /**
   * ลบประเภทลาออกจากรายการ — archive ไม่ใช่ลบแถว (ใบลาเก่าและบัญชีสิทธิ์วันลาที่ห้ามแก้ย้อนหลัง
   * ยังชี้มาที่ประเภทนี้) หลังจากนี้เลือกประเภทนี้ลงวันหยุด/ลาใหม่ไม่ได้ ใบที่มีอยู่แล้วไม่เปลี่ยน
   *
   * code ถูกต่อท้ายด้วย id — ปล่อย code เดิมให้ประเภทใหม่ชื่อเดียวกันใช้ได้ (สร้างผิดแล้วลบ สร้างใหม่)
   * ต้องเหลือประเภทที่ใช้งานอย่างน้อยหนึ่งประเภท ไม่งั้นพนักงานลงวันหยุดเองไม่ได้เลย
   *
   * mergeInto = รวมเข้าประเภทอื่น: ใบทุกใบของประเภทนี้ย้ายไปประเภทปลายทางก่อน (ปฏิทิน/โควตารายเดือน
   * นับรวมกันเป็นประเภทเดียว) — ใช้กับประเภทที่สร้างซ้ำกัน · บัญชีสิทธิ์วันลา (ledger) แก้ย้อนหลังไม่ได้
   * จึงคงอยู่ใต้ประเภทเดิมที่ถูกเก็บเข้ากรุ ซึ่งไม่กระทบประเภทที่เป็นสิทธิ์รายเดือน (นับจากใบโดยตรง)
   */
  async archiveLeaveType(leaveTypeId: string, mergeInto: string | null = null): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.id, leaveTypeId))
        .limit(1);
      const type = types[0];
      if (type === undefined) throw AppError.notFound('leave type');
      // ลบไปแล้วแต่ยังไม่ได้ย้ายใบ (ตอนลบเลือก "คงชื่อเดิม") — เรียกซ้ำพร้อม mergeInto เพื่อย้ายใบที่เหลือทีหลังได้
      const alreadyArchived = type.archivedAt !== null;
      if (alreadyArchived && mergeInto === null) return { id: leaveTypeId, archived: true, moved_requests: 0 };

      const active = alreadyArchived
        ? []
        : await uow.tx
        .select({ id: schema.leaveTypes.id })
        .from(schema.leaveTypes)
        .where(and(eq(schema.leaveTypes.companyId, type.companyId), isNull(schema.leaveTypes.archivedAt)))
        .limit(2);
      if (!alreadyArchived && active.length <= 1) {
        throw AppError.validation('at least one leave type must remain');
      }

      let moved = 0;
      if (mergeInto !== null) {
        if (mergeInto === leaveTypeId) throw AppError.validation('cannot merge a leave type into itself');
        const targets = await uow.tx
          .select()
          .from(schema.leaveTypes)
          .where(eq(schema.leaveTypes.id, mergeInto))
          .limit(1);
        const target = targets[0];
        if (target === undefined || target.companyId !== type.companyId || target.archivedAt !== null) {
          throw AppError.notFound('leave type');
        }
        const rows = await uow.tx
          .update(schema.leaveRequests)
          .set({ leaveTypeId: mergeInto })
          .where(eq(schema.leaveRequests.leaveTypeId, leaveTypeId))
          .returning({ id: schema.leaveRequests.id });
        moved = rows.length;
      }

      if (!alreadyArchived) {
        await uow.tx
          .update(schema.leaveTypes)
          .set({ archivedAt: new Date(), code: `${type.code}~${leaveTypeId.slice(0, 8)}` })
          .where(eq(schema.leaveTypes.id, leaveTypeId));
      }

      await uow.audit({
        action: 'leave.type.archive',
        resourceType: 'leave_type',
        resourceId: leaveTypeId,
        outcome: 'SUCCESS',
        companyId: type.companyId,
        before: { name: type.name, code: type.code },
        after: mergeInto === null ? {} : { merged_into: mergeInto, moved_requests: moved },
      });

      return { id: leaveTypeId, archived: true, moved_requests: moved };
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
   * เปิด/ปิดให้ประเภทลานับสิทธิ์ต่อเดือนจากวันหยุดบริษัทและทบยอดได้ (Holiday)
   * เปิดแล้วไม่ใช้ monthly_quota_days ของประเภทนั้นอีก — ปิดก็กลับไปใช้ตามเดิม ไม่มีข้อมูลหาย
   */
  async setHolidayAccrual(leaveTypeId: string, enabled: boolean): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.id, leaveTypeId))
        .limit(1);
      const type = types[0];
      if (type === undefined) throw AppError.notFound('leave type');

      if (enabled && type.archivedAt !== null) throw AppError.validation('this leave type is no longer available');
      // บริษัทหนึ่งมี Holiday แบบสะสมได้ประเภทเดียว — เปิดตัวใหม่ = ย้ายมาใช้ตัวนี้แทนตัวเดิม
      if (enabled) {
        await uow.tx
          .update(schema.leaveTypes)
          .set({ accruesFromHolidays: false })
          .where(and(eq(schema.leaveTypes.companyId, type.companyId), eq(schema.leaveTypes.accruesFromHolidays, true)));
      }
      // เริ่มนับจากเดือนที่เปิดใช้ครั้งแรก ไม่ย้อนหลัง — ปิดแล้วเปิดใหม่ยังนับต่อจากเดือนเดิม
      let startsOn = type.accrualStartsOn;
      if (enabled && startsOn === null) {
        const companies = await uow.tx
          .select({ timeZone: schema.companies.timeZone })
          .from(schema.companies)
          .where(eq(schema.companies.id, type.companyId))
          .limit(1);
        const today = LocalDate.fromInstant(this.clock.now(), companies[0]?.timeZone ?? 'Asia/Bangkok');
        startsOn = today.firstDayOfMonth().toString();
      }
      await uow.tx
        .update(schema.leaveTypes)
        .set({ accruesFromHolidays: enabled, accrualStartsOn: startsOn })
        .where(eq(schema.leaveTypes.id, leaveTypeId));

      await uow.audit({
        action: 'leave.type.holiday_accrual',
        resourceType: 'leave_type',
        resourceId: leaveTypeId,
        outcome: 'SUCCESS',
        companyId: type.companyId,
        before: { accrues_from_holidays: type.accruesFromHolidays },
        after: { accrues_from_holidays: enabled },
      });

      return { id: leaveTypeId, accrues_from_holidays: enabled };
    });
  }

  /** วันหยุดบริษัทในช่วงเดือน จัดกลุ่มรายเดือน — วันเดียวกันที่อยู่หลายปฏิทินนับครั้งเดียว */
  private async companyHolidaysByMonth(
    tx: Tx,
    companyId: string,
    fromMonth: string,
    toMonth: string,
  ): Promise<Map<string, { date: string; name: string }[]>> {
    const fromDate = `${fromMonth}-01`;
    const beforeDate = `${monthOfIndex(monthIndex(toMonth) + 1)}-01`;
    const rows = await tx
      .select({ date: schema.holidayDates.holidayDate, name: schema.holidayDates.name })
      .from(schema.holidayDates)
      .innerJoin(schema.holidayCalendars, eq(schema.holidayCalendars.id, schema.holidayDates.calendarId))
      .where(
        and(
          eq(schema.holidayCalendars.companyId, companyId),
          sql`${schema.holidayDates.holidayDate} >= ${fromDate}`,
          sql`${schema.holidayDates.holidayDate} < ${beforeDate}`,
        ),
      );
    const byMonth = new Map<string, { date: string; name: string }[]>();
    for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
      const list = byMonth.get(row.date.slice(0, 7)) ?? [];
      if (!list.some((item) => item.date === row.date)) list.push({ date: row.date, name: row.name });
      byMonth.set(row.date.slice(0, 7), list);
    }
    return byMonth;
  }

  /** สิทธิ์ Holiday ต่อเดือนของบริษัท: จำนวนที่ HR กำหนดทับ ถ้าไม่มีใช้จำนวนวันหยุดบริษัทของเดือนนั้น */
  private async holidayGrants(
    tx: Tx,
    companyId: string,
    leaveTypeId: string,
    fromMonth: string,
    toMonth: string,
  ): Promise<Map<string, number>> {
    const holidays = await this.companyHolidaysByMonth(tx, companyId, fromMonth, toMonth);
    const overrides = await tx
      .select({ month: schema.leaveMonthAllowances.month, days: schema.leaveMonthAllowances.days })
      .from(schema.leaveMonthAllowances)
      .where(eq(schema.leaveMonthAllowances.leaveTypeId, leaveTypeId));
    const grants = new Map<string, number>();
    for (const [month, list] of holidays) grants.set(month, list.length);
    for (const row of overrides) grants.set(row.month.slice(0, 7), row.days);
    return grants;
  }

  /**
   * ข้อมูลตั้งต้นของการคิดยอด Holiday ของคนหนึ่ง (ดู holiday-accrual.ts)
   *
   * เริ่มนับจากเดือนที่เริ่มงาน แต่ย้อนไม่เกิน 12 เดือนก่อนเดือนที่ถาม — สิทธิ์เก่ากว่านั้นหมดอายุไปนานแล้ว
   * excludeRequestId = ใบที่กำลังจะถูกแทนที่ (สลับวัน) ไม่นับเป็นการใช้
   */
  private async holidayLedger(
    tx: Tx,
    employment: { id: string; companyId: string; hiredOn: string },
    leaveType: { id: string; accrualStartsOn: string | null },
    fromMonth: string,
    toMonth: string,
    excludeRequestId?: string,
  ): Promise<HolidayLedgerInput> {
    const leaveTypeId = leaveType.id;
    const start = monthOfIndex(
      Math.max(
        monthIndex(employment.hiredOn.slice(0, 7)),
        monthIndex(fromMonth) - 12,
        // ก่อนเดือนที่เปิดใช้ไม่นับทั้งสิทธิ์และการใช้ — เริ่มนับใหม่จากเดือนนั้น
        leaveType.accrualStartsOn === null ? 0 : monthIndex(leaveType.accrualStartsOn.slice(0, 7)),
      ),
    );
    const startDate = `${start}-01`;
    const requests = await tx
      .select({
        id: schema.leaveRequests.id,
        startsOn: schema.leaveRequests.startsOn,
        totalMinutes: schema.leaveRequests.totalMinutes,
        status: schema.leaveRequests.status,
        swapFromDate: schema.leaveRequests.swapFromDate,
      })
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.employmentId, employment.id),
          eq(schema.leaveRequests.leaveTypeId, leaveTypeId),
          // นับทั้งใบที่รออนุมัติ — กันสิทธิ์ไว้แล้ว เหมือนโควตารายเดือน
          inArray(schema.leaveRequests.status, ['SUBMITTED', 'APPROVED']),
          sql`${schema.leaveRequests.startsOn} >= ${startDate}`,
        ),
      );
    const usage = new Map<string, number>();
    let end = toMonth;
    for (const request of requests) {
      if (request.id === excludeRequestId) continue;
      if (isPendingSwap(request)) continue;
      const month = request.startsOn.slice(0, 7);
      usage.set(month, (usage.get(month) ?? 0) + request.totalMinutes / 480);
      if (month > end) end = month;
    }
    const grants = await this.holidayGrants(tx, employment.companyId, leaveTypeId, start, end);
    return { from: start, to: end, grants, usage };
  }

  /**
   * ยอด Holiday ที่ตัวเองลงได้ในแต่ละเดือนของช่วงที่ถาม — หน้าลงวันหยุดใช้ซ่อนประเภทที่สิทธิ์หมด
   * คืนเฉพาะประเภทที่เปิดนับสิทธิ์จากวันหยุดบริษัท ประเภทอื่นไม่มีในผลลัพธ์ (= ไม่ได้คุมด้วยกฎนี้)
   */
  async myHolidayAllowances(
    fromMonth: string,
    toMonth: string,
  ): Promise<{
    items: {
      leave_type_id: string;
      months: { month: string; available_days: number; buckets: HolidayBucket[] }[];
    }[];
  }> {
    if (monthIndex(toMonth) < monthIndex(fromMonth) || monthIndex(toMonth) - monthIndex(fromMonth) > 23) {
      throw AppError.validation('month range must be 1-24 months');
    }
    return this.uow.run(async (uow) => {
      const employmentId = this.requestContext.requirePrincipal().employmentId;
      if (employmentId === null) return { items: [] };
      const employments = await uow.tx
        .select()
        .from(schema.employments)
        .where(eq(schema.employments.id, employmentId))
        .limit(1);
      const employment = employments[0];
      if (employment === undefined) return { items: [] };

      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.companyId, employment.companyId),
            eq(schema.leaveTypes.accruesFromHolidays, true),
            isNull(schema.leaveTypes.archivedAt),
          ),
        );

      const items = [];
      for (const type of types) {
        const ledger = await this.holidayLedger(uow.tx, employment, type, fromMonth, toMonth);
        const months = [];
        for (let index = monthIndex(fromMonth); index <= monthIndex(toMonth); index += 1) {
          months.push({ month: monthOfIndex(index), ...holidayAvailability(ledger, monthOfIndex(index)) });
        }
        items.push({ leave_type_id: type.id, months });
      }
      return { items };
    });
  }

  /**
   * ยอด Holiday คงเหลือของพนักงานทุกคนในบริษัท ณ เดือนหนึ่ง — ให้ HR เห็นว่าใครเหลือกี่วัน
   * และใครมีวันที่ต้องใช้ภายในเดือนนั้น (ไม่งั้นถูกตัดทิ้ง)
   *
   * คิดด้วยกฎเดียวกับ myHolidayAllowances ทุกประการ แต่ดึงสิทธิ์รายเดือนและใบของทุกคนครั้งเดียว
   * ไม่วนถามฐานข้อมูลทีละคน · คืนเฉพาะ employment_id — ชื่อให้ฝั่งเรียกจับคู่จาก /employments
   */
  async listHolidayBalances(
    leaveTypeId: string,
    month: string,
  ): Promise<{
    items: {
      employment_id: string;
      available_days: number;
      expiring_days: number;
      used_days: number;
      buckets: HolidayBucket[];
    }[];
  }> {
    return this.uow.run(async (uow) => {
      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.id, leaveTypeId))
        .limit(1);
      const type = types[0];
      if (type === undefined) throw AppError.notFound('leave type');

      const firstMonth = monthOfIndex(
        Math.max(
          monthIndex(month) - 12,
          type.accrualStartsOn === null ? 0 : monthIndex(type.accrualStartsOn.slice(0, 7)),
        ),
      );
      const firstDate = `${firstMonth}-01`;
      const monthStart = `${month}-01`;

      const employments = await uow.tx
        .select({
          id: schema.employments.id,
          hiredOn: schema.employments.hiredOn,
          terminatedOn: schema.employments.terminatedOn,
        })
        .from(schema.employments)
        .where(and(eq(schema.employments.companyId, type.companyId), eq(schema.employments.status, 'ACTIVE')));

      const requests = await uow.tx
        .select({
          employmentId: schema.leaveRequests.employmentId,
          startsOn: schema.leaveRequests.startsOn,
          totalMinutes: schema.leaveRequests.totalMinutes,
          status: schema.leaveRequests.status,
          swapFromDate: schema.leaveRequests.swapFromDate,
        })
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.leaveTypeId, leaveTypeId),
            inArray(schema.leaveRequests.status, ['SUBMITTED', 'APPROVED']),
            sql`${schema.leaveRequests.startsOn} >= ${firstDate}`,
          ),
        );
      let lastMonth = month;
      const usageOf = new Map<string, Map<string, number>>();
      for (const request of requests) {
        if (isPendingSwap(request)) continue;
        const requestMonth = request.startsOn.slice(0, 7);
        const usage = usageOf.get(request.employmentId) ?? new Map<string, number>();
        usage.set(requestMonth, (usage.get(requestMonth) ?? 0) + request.totalMinutes / 480);
        usageOf.set(request.employmentId, usage);
        if (requestMonth > lastMonth) lastMonth = requestMonth;
      }
      const grants = await this.holidayGrants(uow.tx, type.companyId, leaveTypeId, firstMonth, lastMonth);

      const items = [];
      for (const employment of employments) {
        // ออกจากงานก่อนเดือนนี้แล้ว — ไม่มีสิทธิ์ให้ดู
        if (employment.terminatedOn !== null && employment.terminatedOn < monthStart) continue;
        const from = monthOfIndex(
          Math.max(monthIndex(firstMonth), monthIndex(employment.hiredOn.slice(0, 7))),
        );
        // ใบที่ลงไว้ก่อนเดือนเริ่มนับของคนนี้ไม่นำมาคิด เหมือน holidayLedger
        const usage = new Map([...(usageOf.get(employment.id) ?? [])].filter(([usedIn]) => usedIn >= from));
        const { available_days, buckets } = holidayAvailability({ from, to: lastMonth, grants, usage }, month);
        items.push({
          employment_id: employment.id,
          available_days,
          expiring_days: buckets
            .filter((bucket) => bucket.expires_month === month)
            .reduce((sum, bucket) => sum + bucket.remaining_days, 0),
          used_days: usage.get(month) ?? 0,
          buckets,
        });
      }
      return { items };
    });
  }

  /**
   * ตารางสิทธิ์ Holiday รายเดือนของปีหนึ่ง — ให้ HR เห็นว่าเดือนไหนมีวันหยุดบริษัทกี่วัน
   * และเดือนไหนถูกกำหนดจำนวนทับไว้
   */
  async listMonthAllowances(
    leaveTypeId: string,
    year: number,
  ): Promise<{
    items: {
      month: string;
      holiday_count: number;
      holidays: { date: string; name: string }[];
      override_days: number | null;
      days: number;
    }[];
  }> {
    return this.uow.run(async (uow) => {
      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.id, leaveTypeId))
        .limit(1);
      const type = types[0];
      if (type === undefined) throw AppError.notFound('leave type');

      const first = `${String(year)}-01`;
      const last = `${String(year)}-12`;
      const holidays = await this.companyHolidaysByMonth(uow.tx, type.companyId, first, last);
      const overrides = await uow.tx
        .select({ month: schema.leaveMonthAllowances.month, days: schema.leaveMonthAllowances.days })
        .from(schema.leaveMonthAllowances)
        .where(eq(schema.leaveMonthAllowances.leaveTypeId, leaveTypeId));
      const overrideOf = new Map(overrides.map((row) => [row.month.slice(0, 7), row.days]));

      const items = [];
      for (let index = monthIndex(first); index <= monthIndex(last); index += 1) {
        const month = monthOfIndex(index);
        const list = holidays.get(month) ?? [];
        const override = overrideOf.get(month) ?? null;
        items.push({
          month,
          holiday_count: list.length,
          holidays: list,
          override_days: override,
          days: override ?? list.length,
        });
      }
      return { items };
    });
  }

  /** HR กำหนดจำนวนวัน Holiday ของเดือนหนึ่งทับ — days = null ลบค่าทับ กลับไปนับจากวันหยุดบริษัท */
  async setMonthAllowance(
    leaveTypeId: string,
    month: string,
    days: number | null,
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const types = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(eq(schema.leaveTypes.id, leaveTypeId))
        .limit(1);
      const type = types[0];
      if (type === undefined) throw AppError.notFound('leave type');

      const monthStart = `${month}-01`;
      const scope = and(
        eq(schema.leaveMonthAllowances.leaveTypeId, leaveTypeId),
        eq(schema.leaveMonthAllowances.month, monthStart),
      );
      const existing = await uow.tx.select().from(schema.leaveMonthAllowances).where(scope).limit(1);
      const updatedBy = this.requestContext.requirePrincipal().principalId;

      if (days === null) {
        await uow.tx.delete(schema.leaveMonthAllowances).where(scope);
      } else if (existing[0] === undefined) {
        await uow.tx.insert(schema.leaveMonthAllowances).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          companyId: type.companyId,
          leaveTypeId,
          month: monthStart,
          days,
          updatedBy,
        });
      } else {
        await uow.tx
          .update(schema.leaveMonthAllowances)
          .set({ days, updatedAt: this.clock.now(), updatedBy })
          .where(scope);
      }

      await uow.audit({
        action: 'leave.type.month_allowance',
        resourceType: 'leave_type',
        resourceId: leaveTypeId,
        outcome: 'SUCCESS',
        companyId: type.companyId,
        before: { month, days: existing[0]?.days ?? null },
        after: { month, days },
      });

      return { leave_type_id: leaveTypeId, month, days };
    });
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
    display_label: string;
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
      // ประเภทที่ถูกลบออกจากรายการแล้ว — ใบเก่ายังอยู่ แต่ยื่นใบใหม่ไม่ได้
      if (leaveType.archivedAt !== null) throw AppError.validation('this leave type is no longer available');

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
      if (leaveType.accruesFromHolidays) {
        /*
         * Holiday — สิทธิ์ต่อเดือนมาจากวันหยุดบริษัทและทบยอดได้ ไม่ใช่เลขเดียวทุกเดือน
         * (ดู holiday-accrual.ts) ใบที่กำลังถูกสลับออกไม่นับเป็นการใช้ เหมือนโควตารายเดือนด้านล่าง
         */
        const month = input.starts_on.slice(0, 7);
        const ledger = await this.holidayLedger(
          uow.tx,
          employment,
          leaveType,
          month,
          month,
          swapFromRequest?.id,
        );
        const { available_days: availableDays } = holidayAvailability(ledger, month);
        const requestedDays = input.total_minutes / 480;
        if (requestedDays > availableDays) {
          throw AppError.validation('holiday balance exceeded', {
            meta: { available_days: availableDays, requested_days: requestedDays },
          });
        }
      } else if (leaveType.monthlyQuotaDays > 0) {
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
        displayLabel: input.display_label,
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
   * เปลี่ยนชื่อที่ขึ้นบนปฏิทินของใบที่ยื่นไปแล้ว
   *
   * แยกจาก decide/cancel เพราะไม่กระทบสิทธิ์ ยอดวันลา หรือผลลงเวลาเลย —
   * เป็นแค่ป้ายชื่อ จึงไม่ต้องยกเลิกใบเดิมแล้วยื่นใหม่เพียงเพราะพิมพ์ผิด
   *
   * ตรวจความเป็นเจ้าของแบบเดียวกับ cancelRequest: ของตัวเองแก้ได้เสมอ
   * ของคนอื่นต้องมี workforce.leave.approve
   *
   * ใบที่ยกเลิก/ไม่อนุมัติไปแล้วแก้ไม่ได้ — มันไม่ขึ้นปฏิทินอยู่แล้ว การยอมให้
   * แก้มีแต่จะทำให้ประวัติที่ใช้ตรวจสอบย้อนหลังเพี้ยนโดยไม่ได้อะไรกลับมา
   */
  async relabelRequest(requestId: string, displayLabel: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const requests = await uow.tx
        .select()
        .from(schema.leaveRequests)
        .where(eq(schema.leaveRequests.id, requestId))
        .limit(1);
      const request = requests[0];
      if (request === undefined) throw AppError.notFound('leave request');
      if (request.status !== 'SUBMITTED' && request.status !== 'APPROVED') {
        throw AppError.conflict('leave request is no longer active');
      }

      const principal = this.requestContext.requirePrincipal();
      const isOwn = principal.employmentId !== null && principal.employmentId === request.employmentId;
      if (!isOwn && !principal.permissions.has('workforce.leave.approve')) {
        throw AppError.forbidden('cannot rename a leave request that belongs to someone else');
      }

      await uow.tx
        .update(schema.leaveRequests)
        .set({ displayLabel })
        .where(eq(schema.leaveRequests.id, requestId));

      await uow.audit({
        action: 'leave.request.relabel',
        resourceType: 'leave_request',
        resourceId: requestId,
        outcome: 'SUCCESS',
        companyId: request.companyId,
        before: { display_label: request.displayLabel },
        after: { display_label: displayLabel },
      });

      return { id: requestId, display_label: displayLabel };
    });
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
  /**
   * วันหยุดตามสิทธิ์ของคนหนึ่ง — ใบลาที่อนุมัติแล้วของประเภทที่อนุมัติอัตโนมัติ
   * (เช่นวันหยุดประจำเดือน) ไม่ใช่การลาจริง ผลลงเวลาคิดวันนั้นเหมือนวันหยุด
   */
  async dayOffDates(tx: Tx, employmentId: string, from: string, to: string): Promise<Set<string>> {
    const rows = await tx
      .select({ startsOn: schema.leaveRequests.startsOn, endsOn: schema.leaveRequests.endsOn })
      .from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
      .where(
        and(
          eq(schema.leaveRequests.employmentId, employmentId),
          eq(schema.leaveRequests.status, 'APPROVED'),
          eq(schema.leaveTypes.autoApprove, true),
          sql`${schema.leaveRequests.endsOn} >= ${from}`,
          sql`${schema.leaveRequests.startsOn} <= ${to}`,
        ),
      );

    const dates = new Set<string>();
    for (const row of rows) {
      const start = LocalDate.parse(row.startsOn);
      const days = start.daysUntil(LocalDate.parse(row.endsOn)) + 1;
      for (let offset = 0; offset < days; offset += 1) {
        const key = start.plusDays(offset).toString();
        if (key >= from && key <= to) dates.add(key);
      }
    }
    return dates;
  }

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
  async listTypes(
    companyId?: string,
    includeArchived = false,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const scope = [
        ...(companyId === undefined ? [] : [eq(schema.leaveTypes.companyId, companyId)]),
        // ปกติเฉพาะประเภทที่ยังใช้งาน — หน้าตั้งค่าขอรวมที่ลบแล้วด้วย เพื่อย้ายใบที่ยังค้างอยู่ใต้ประเภทนั้น
        ...(includeArchived ? [] : [isNull(schema.leaveTypes.archivedAt)]),
      ];
      // จำนวนใบที่ยังชี้มาที่ประเภทที่ลบแล้ว — บอกว่ายังมีอะไรให้ย้ายไหม
      const usage = includeArchived
        ? await uow.tx
            .select({ leaveTypeId: schema.leaveRequests.leaveTypeId, n: sql<number>`count(*)::int` })
            .from(schema.leaveRequests)
            .groupBy(schema.leaveRequests.leaveTypeId)
        : [];
      const usedBy = new Map(usage.map((u) => [u.leaveTypeId, Number(u.n)]));
      const rows = await uow.tx
        .select()
        .from(schema.leaveTypes)
        .where(scope.length === 0 ? undefined : and(...scope))
        .limit(400);

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
          accrues_from_holidays: row.accruesFromHolidays,
          accrual_starts_on: row.accrualStartsOn,
          show_on_calendar: row.showOnCalendar,
          requires_reports: row.requiresReports,
          ...(includeArchived
            ? { archived: row.archivedAt !== null, request_count: usedBy.get(row.id) ?? 0 }
            : {}),
        })),
      };
    });
  }

  /**
   * ปฏิทินวันหยุดรวมของทีม — ใครหยุดวันไหนบ้าง เป็นวันหยุดชนิดไหน
   *
   * แยกจาก listRequests เพราะสิทธิ์คนละชั้น: listRequests ต้องมี
   * workforce.leave.manage ซึ่ง role EMPLOYEE ไม่มี ⇒ พนักงานจะมองไม่เห็น
   * แม้แต่วันหยุดของตัวเอง แต่ทั้งทีมต้องเห็นว่าใครหยุดวันไหนถึงจะวางแผนงานได้
   *
   * ⚠ **ไม่คืนเหตุผล** ของคนอื่นเลย — เหตุผลเป็นข้อความอิสระที่มักมีเรื่อง
   * ส่วนตัว/สุขภาพปนอยู่ คนที่ต้องอ่านคือผู้อนุมัติ ซึ่งใช้ listRequests อยู่แล้ว
   *
   * ส่วน **ประเภทการลา** คืนตามค่า show_on_calendar ของประเภทนั้น (ตั้งค่าได้
   * รายบริษัท) — เดิมตัดออกทั้งหมดเพื่อกันเรื่อง "ลาป่วย" แต่ผลข้างเคียงคือ
   * ปฏิทินบอกไม่ได้ว่าวันนั้นเป็นวันหยุดประจำเดือนหรือลาป่วย ซึ่งเป็นสิ่งที่
   * คนวางแผนงานต้องรู้ ⇒ ให้บริษัทปิดเป็นรายประเภทแทนการปิดตายทั้งระบบ
   * ใบของตัวเองเห็นประเภทเสมอไม่ว่าตั้งค่าไว้อย่างไร
   */
  async listCalendar(query: { from: string; to: string }): Promise<{
    items: Record<string, unknown>[];
  }> {
    return this.uow.run(async (uow) => {
      // ใบของตัวเองเห็นประเภทการลาเสมอ แม้ประเภทนั้นจะถูกตั้งให้ซ่อนจากคนอื่น
      const ownEmploymentId = this.requestContext.requirePrincipal().employmentId;

      const rows = await uow.tx
        .select({
          id: schema.leaveRequests.id,
          employmentId: schema.leaveRequests.employmentId,
          startsOn: schema.leaveRequests.startsOn,
          endsOn: schema.leaveRequests.endsOn,
          status: schema.leaveRequests.status,
          swapFromDate: schema.leaveRequests.swapFromDate,
          displayLabel: schema.leaveRequests.displayLabel,
          employeeCode: schema.employments.employeeCode,
          firstName: schema.people.firstName,
          lastName: schema.people.lastName,
          preferredName: schema.people.preferredName,
          leaveTypeId: schema.leaveRequests.leaveTypeId,
          leaveTypeName: schema.leaveTypes.name,
          leaveTypePaid: schema.leaveTypes.paid,
          leaveTypeAutoApprove: schema.leaveTypes.autoApprove,
          leaveTypeShowOnCalendar: schema.leaveTypes.showOnCalendar,
        })
        .from(schema.leaveRequests)
        .innerJoin(
          schema.employments,
          eq(schema.employments.id, schema.leaveRequests.employmentId),
        )
        .innerJoin(schema.people, eq(schema.people.id, schema.employments.personId))
        .innerJoin(
          schema.leaveTypes,
          eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId),
        )
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
        items: rows.map((row) => {
          const isOwn = ownEmploymentId !== null && row.employmentId === ownEmploymentId;
          const showType = isOwn || row.leaveTypeShowOnCalendar;
          return {
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
            /*
             * ประเภทที่ถูกซ่อนคืน id เป็น null ด้วย ไม่ใช่ซ่อนแค่ชื่อ — ไม่งั้น
             * เอา id ไปเทียบกับ /leave-types (ทุกคนอ่านได้) ก็รู้ชื่ออยู่ดี
             */
            leave_type_id: showType ? row.leaveTypeId : null,
            leave_type_name: showType ? row.leaveTypeName : null,
            leave_type_paid: showType ? row.leaveTypePaid : null,
            /** true = ประเภทที่ลงแล้วมีผลทันที ไม่ต้องรออนุมัติ */
            leave_type_auto_approve: showType ? row.leaveTypeAutoApprove : null,
            /*
             * มีค่า = ใบนี้เป็นคำขอ "สลับ" มาแทนวันนั้น ปฏิทินต้องบอกให้เห็น
             * ไม่งั้นวันเดิมกับวันใหม่ขึ้นเป็นสองวันหยุดที่ไม่เกี่ยวกัน ทั้งที่
             * อนุมัติเมื่อไรวันเดิมจะหายไปทันที
             */
            swap_from_date: row.swapFromDate,
            /*
             * ชื่อที่เจ้าตัวตั้งเอง ('' = ให้หน้าจอประกอบจากชื่อ+ประเภทเหมือนเดิม)
             *
             * ไม่ถูกปิดตาม show_on_calendar เพราะเป็นข้อความที่เจ้าของใบพิมพ์เอง
             * — เขาเลือกแล้วว่าจะบอกทีมแค่ไหน ต่างจากชื่อประเภทที่ระบบเปิดเผยให้
             */
            display_label: row.displayLabel,
          };
        }),
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
          /*
           * เหตุผลกับวันเดิมของคำขอสลับหายไปจาก payload มาตลอด — หน้าจออนุมัติ
           * จึงขึ้น "—" ทุกใบ และผู้อนุมัติมองไม่ออกว่าใบไหนเป็นการสลับ (ซึ่ง
           * พออนุมัติแล้วจะไปยกเลิกวันเดิมให้ด้วย) endpoint นี้ต้องมีสิทธิ์
           * workforce.leave.manage อยู่แล้ว จึงไม่ใช่การเปิดข้อมูลให้คนทั่วไป
           */
          reason: row.reason,
          swap_from_date: row.swapFromDate,
          display_label: row.displayLabel,
        })),
      };
    });
  }

}
