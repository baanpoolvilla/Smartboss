import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateShiftInput,
  CreateWorkPolicyInput,
  SetRecurringPatternInput,
} from '@workforce/contracts';
import { schema, type Tx } from '@workforce/db';
import {
  AppError,
  EffectivePeriod,
  LocalDate,
  parseTimeOfDay,
  uuidv7,
  type Clock,
} from '@workforce/domain';
import { and, asc, desc, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { CLOCK } from '../shared/tokens';

@Injectable()
export class SchedulingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly requestContext: RequestContextService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** กะทั้งหมดพร้อมเวลาพัก — หน้าจอตั้งค่าต้องเห็นทั้งสองอย่างพร้อมกัน */
  async listShifts(companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const shifts = await uow.tx
        .select()
        .from(schema.shiftDefinitions)
        .where(companyId === undefined ? undefined : eq(schema.shiftDefinitions.companyId, companyId))
        .orderBy(asc(schema.shiftDefinitions.startMinutes), asc(schema.shiftDefinitions.code));

      const items: Record<string, unknown>[] = [];
      for (const shift of shifts) {
        const breaks = await uow.tx
          .select()
          .from(schema.shiftBreakRules)
          .where(eq(schema.shiftBreakRules.shiftId, shift.id))
          .orderBy(asc(schema.shiftBreakRules.startMinutes));

        items.push({
          id: shift.id,
          company_id: shift.companyId,
          code: shift.code,
          name: shift.name,
          start_minutes: shift.startMinutes,
          end_minutes: shift.endMinutes,
          rest_day: shift.restDay,
          work_policy_id: shift.workPolicyId,
          site_id: shift.siteId,
          allowed_methods: shift.allowedMethods,
          status: shift.status,
          breaks: breaks.map((rule) => ({
            start_minutes: rule.startMinutes,
            duration_minutes: rule.durationMinutes,
            paid: rule.paid,
            auto_deduct: rule.autoDeduct,
          })),
        });
      }

      return { items };
    });
  }

  async listWorkPolicies(companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.workPolicies)
        .where(companyId === undefined ? undefined : eq(schema.workPolicies.companyId, companyId))
        .orderBy(asc(schema.workPolicies.code));

      return {
        items: rows.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          code: row.code,
          name: row.name,
          late_mode: row.lateMode,
          grace_minutes: row.graceMinutes,
          early_out_tolerance_minutes: row.earlyOutToleranceMinutes,
          max_shift_minutes: row.maxShiftMinutes,
          ot_requires_approval: row.otRequiresApproval,
          effective_from: row.effectiveFrom,
          effective_to: row.effectiveTo,
        })),
      };
    });
  }

  async listRosterPeriods(companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.rosterPeriods)
        .where(companyId === undefined ? undefined : eq(schema.rosterPeriods.companyId, companyId))
        .orderBy(desc(schema.rosterPeriods.startsOn));

      return {
        items: rows.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          name: row.name,
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          status: row.status,
          published_at: row.publishedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  /** ตารางกะที่มอบหมายไว้ในช่วงวันที่ — ใช้ทั้งหน้าพนักงานรายคนและหน้าตารางรวม */
  async listShiftAssignments(filter: {
    from: string;
    to: string;
    employmentId?: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const conditions = [
        gte(schema.shiftAssignments.workDate, filter.from),
        lte(schema.shiftAssignments.workDate, filter.to),
        filter.employmentId === undefined
          ? undefined
          : eq(schema.shiftAssignments.employmentId, filter.employmentId),
      ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);

      const rows = await uow.tx
        .select({ assignment: schema.shiftAssignments, shift: schema.shiftDefinitions })
        .from(schema.shiftAssignments)
        .leftJoin(
          schema.shiftDefinitions,
          eq(schema.shiftAssignments.shiftId, schema.shiftDefinitions.id),
        )
        .where(and(...conditions))
        .orderBy(asc(schema.shiftAssignments.workDate));

      return {
        items: rows.map((row) => ({
          id: row.assignment.id,
          employment_id: row.assignment.employmentId,
          work_date: row.assignment.workDate,
          shift_id: row.assignment.shiftId,
          shift_code: row.shift?.code ?? null,
          shift_name: row.shift?.name ?? null,
          start_minutes: row.shift?.startMinutes ?? null,
          end_minutes: row.shift?.endMinutes ?? null,
          rest_day: row.shift?.restDay ?? false,
          status: row.assignment.status,
          note: row.assignment.note,
        })),
      };
    });
  }

  /**
   * ตารางกะประจำสัปดาห์ของพนักงานคนหนึ่ง — ใบที่ใช้อยู่และประวัติที่ปิดไปแล้ว
   *
   * เดิมมีแต่ POST: ผูกกะไปแล้วไม่มีทางอ่านกลับ หน้าจอจึงได้แต่เดาแล้วเติม
   * "ค่าตั้งต้นที่แนะนำ" ลงช่อง ซึ่งอ่านแล้วแยกไม่ออกว่าคือของที่ผูกไว้จริง
   * หรือค่าที่ระบบเดาให้ ⇒ กดทับของเดิมโดยไม่รู้ตัวได้ทุกเมื่อ
   *
   * คืนชื่อกะมาด้วย ไม่ใช่แค่ id — หน้าจอต้องแสดงว่าจันทร์คือกะอะไรโดยไม่ต้อง
   * ไปไล่จับคู่กับ /shifts เอง (และไม่พังเมื่อคนดูไม่มีสิทธิ์อ่านรายการกะ)
   */
  async listRecurringPatterns(
    employmentId: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.recurringWorkPatterns)
        .where(eq(schema.recurringWorkPatterns.employmentId, employmentId))
        .orderBy(desc(schema.recurringWorkPatterns.effectiveFrom));

      const shifts = await uow.tx.select().from(schema.shiftDefinitions);
      const byId = new Map(shifts.map((shift) => [shift.id, shift]));
      const describe = (
        shiftId: string | null,
      ): { id: string | null; code: string | null; name: string | null; rest_day: boolean } => {
        const shift = shiftId === null ? undefined : byId.get(shiftId);
        return {
          id: shiftId,
          code: shift?.code ?? null,
          name: shift?.name ?? null,
          rest_day: shift?.restDay ?? false,
        };
      };

      return {
        items: rows.map((row) => ({
          id: row.id,
          employment_id: row.employmentId,
          effective_from: row.effectiveFrom,
          effective_to: row.effectiveTo,
          monday: describe(row.mondayShiftId),
          tuesday: describe(row.tuesdayShiftId),
          wednesday: describe(row.wednesdayShiftId),
          thursday: describe(row.thursdayShiftId),
          friday: describe(row.fridayShiftId),
          saturday: describe(row.saturdayShiftId),
          sunday: describe(row.sundayShiftId),
        })),
      };
    });
  }

  async createWorkPolicy(input: CreateWorkPolicyInput): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      EffectivePeriod.parse(input.effective_from, input.effective_to);

      const id = uuidv7();
      await uow.tx.insert(schema.workPolicies).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        name: input.name,
        lateMode: input.late_mode,
        graceMinutes: input.grace_minutes,
        graceDeduction: input.grace_deduction,
        flexStartMinutes: parseTimeOfDay(input.flex_start),
        flexEndMinutes: parseTimeOfDay(input.flex_end),
        flexRequiredWorkMinutes: input.flex_required_work_minutes,
        earlyOutToleranceMinutes: input.early_out_tolerance_minutes,
        duplicatePunchWindowMinutes: input.duplicate_punch_window_minutes,
        maxShiftMinutes: input.max_shift_minutes,
        excessiveWorkMinutes: input.excessive_work_minutes,
        otRequiresApproval: input.ot_requires_approval,
        otMinimumMinutes: input.ot_minimum_minutes,
        otRoundingMinutes: input.ot_rounding_minutes,
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to,
      });

      await uow.audit({
        action: 'scheduling.work-policy.create',
        resourceType: 'work_policy',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: {
          code: input.code,
          late_mode: input.late_mode,
          grace_minutes: input.grace_minutes,
          grace_deduction: input.grace_deduction,
        },
      });

      return { id, code: input.code, late_mode: input.late_mode };
    });
  }

  async createShift(input: CreateShiftInput): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const startMinutes = parseTimeOfDay(input.start);
      // กะข้ามคืนเก็บ end เป็นนาทีที่เกิน 1440 เพื่อให้คำนวณตรงโดยไม่ต้องเดา
      const endMinutes = parseTimeOfDay(input.end) + (input.crosses_midnight ? 1440 : 0);

      if (!input.rest_day && endMinutes <= startMinutes) {
        throw AppError.validation(
          'shift end must be after start; set crosses_midnight for overnight shifts',
        );
      }

      const id = uuidv7();
      await uow.tx.insert(schema.shiftDefinitions).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        name: input.name,
        startMinutes: input.rest_day ? 0 : startMinutes,
        endMinutes: input.rest_day ? 0 : endMinutes,
        restDay: input.rest_day,
        workPolicyId: input.work_policy_id,
        siteId: input.site_id,
        allowedMethods: [],
      });

      if (input.breaks.length > 0) {
        await uow.tx.insert(schema.shiftBreakRules).values(
          input.breaks.map((rule) => ({
            id: uuidv7(),
            tenantId: uow.tenantId,
            shiftId: id,
            startMinutes: parseTimeOfDay(rule.start),
            durationMinutes: rule.duration_minutes,
            paid: rule.paid,
            autoDeduct: rule.auto_deduct,
          })),
        );
      }

      await uow.audit({
        action: 'scheduling.shift.create',
        resourceType: 'shift_definition',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { code: input.code, start_minutes: startMinutes, end_minutes: endMinutes },
      });

      return { id, code: input.code, start_minutes: startMinutes, end_minutes: endMinutes };
    });
  }

  async setRecurringPattern(input: SetRecurringPatternInput): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const period = EffectivePeriod.parse(input.effective_from, input.effective_to);

      if (input.supersede_current) {
        const open = await this.findOpenPattern(uow.tx, input.employment_id);
        if (open !== undefined) {
          const openPeriod = EffectivePeriod.parse(open.effectiveFrom, null);
          if (openPeriod.from.isBefore(period.from)) {
            await uow.tx
              .update(schema.recurringWorkPatterns)
              .set({ effectiveTo: openPeriod.closeBefore(period.from).to?.toString() })
              .where(eq(schema.recurringWorkPatterns.id, open.id));
          } else {
            /*
             * ใบเดิมเริ่มวันเดียวกันหรือหลังใบใหม่ ⇒ ใบใหม่บังมันทั้งช่วง มันจึงไม่มี
             * วันไหนเลยที่ยังมีผล — เก็บไว้ก็เป็นแถวตายที่ทำให้ resolveShiftId
             * ต้องเลือกระหว่างสองใบที่เริ่มวันเดียวกัน ⇒ ลบทิ้งแล้วบันทึกของเดิมลง audit
             *
             * เดิมตรงนี้โยน error ทิ้ง ซึ่งแปลว่า "ผูกกะผิดแล้วแก้ในวันเดียวกันไม่ได้"
             * — สถานการณ์ที่เกิดทุกครั้งที่คนกดผูกกะแล้วเห็นว่าเลือกวันผิด
             * ทางออกเดียวที่เหลือคือเลื่อนวันเริ่มไปพรุ่งนี้ แปลว่าตารางผิดยังมีผล
             * ทั้งวันนี้ทั้งที่มีคนพยายามแก้แล้ว
             */
            await uow.tx
              .delete(schema.recurringWorkPatterns)
              .where(eq(schema.recurringWorkPatterns.id, open.id));

            await uow.audit({
              action: 'scheduling.pattern.replace',
              resourceType: 'recurring_work_pattern',
              resourceId: open.id,
              outcome: 'SUCCESS',
              before: {
                employment_id: open.employmentId,
                effective_from: open.effectiveFrom,
                monday_shift_id: open.mondayShiftId,
                tuesday_shift_id: open.tuesdayShiftId,
                wednesday_shift_id: open.wednesdayShiftId,
                thursday_shift_id: open.thursdayShiftId,
                friday_shift_id: open.fridayShiftId,
                saturday_shift_id: open.saturdayShiftId,
                sunday_shift_id: open.sundayShiftId,
              },
              after: { replaced_by_effective_from: input.effective_from },
            });
          }
        }
      }

      const id = uuidv7();
      await uow.tx.insert(schema.recurringWorkPatterns).values({
        id,
        tenantId: uow.tenantId,
        employmentId: input.employment_id,
        mondayShiftId: input.monday_shift_id,
        tuesdayShiftId: input.tuesday_shift_id,
        wednesdayShiftId: input.wednesday_shift_id,
        thursdayShiftId: input.thursday_shift_id,
        fridayShiftId: input.friday_shift_id,
        saturdayShiftId: input.saturday_shift_id,
        sundayShiftId: input.sunday_shift_id,
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to,
      });

      await uow.audit({
        action: 'scheduling.pattern.set',
        resourceType: 'recurring_work_pattern',
        resourceId: id,
        outcome: 'SUCCESS',
        after: { employment_id: input.employment_id, effective_from: input.effective_from },
      });

      return { id, employment_id: input.employment_id };
    });
  }

  private async findOpenPattern(
    tx: Tx,
    employmentId: string,
  ): Promise<typeof schema.recurringWorkPatterns.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.recurringWorkPatterns)
      .where(
        and(
          eq(schema.recurringWorkPatterns.employmentId, employmentId),
          isNull(schema.recurringWorkPatterns.effectiveTo),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async createRosterPeriod(input: {
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
      await uow.tx.insert(schema.rosterPeriods).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        name: input.name,
        startsOn: input.starts_on,
        endsOn: input.ends_on,
        status: 'DRAFT',
      });

      await uow.audit({
        action: 'scheduling.roster.create',
        resourceType: 'roster_period',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { name: input.name, starts_on: input.starts_on, ends_on: input.ends_on },
      });

      return { id, status: 'DRAFT' };
    });
  }

  /**
   * ใส่กะลง roster เป็นชุด
   *
   * ยังเป็น DRAFT — พนักงานยังไม่เห็นและ attendance engine ยังไม่ใช้
   * จนกว่าจะ publish (spec §8.1)
   */
  async bulkUpsertAssignments(
    rosterPeriodId: string,
    assignments: readonly {
      employment_id: string;
      work_date: string;
      shift_id: string | null;
      note: string;
    }[],
  ): Promise<{ upserted: number }> {
    return this.uow.run(async (uow) => {
      const rosters = await uow.tx
        .select()
        .from(schema.rosterPeriods)
        .where(eq(schema.rosterPeriods.id, rosterPeriodId))
        .limit(1);
      const roster = rosters[0];
      if (roster === undefined) throw AppError.notFound('roster period');
      if (roster.status !== 'DRAFT') {
        // แก้ตารางที่ประกาศไปแล้วต้องผ่านการ publish ใหม่ ไม่ใช่แก้เงียบ ๆ
        throw AppError.conflict('only a draft roster period can be edited');
      }

      const start = LocalDate.parse(roster.startsOn);
      const end = LocalDate.parse(roster.endsOn);

      for (const assignment of assignments) {
        const workDate = LocalDate.parse(assignment.work_date);
        if (workDate.isBefore(start) || workDate.isAfter(end)) {
          throw AppError.validation(
            `work_date ${assignment.work_date} is outside the roster period`,
          );
        }

        await uow.tx
          .delete(schema.shiftAssignments)
          .where(
            and(
              eq(schema.shiftAssignments.employmentId, assignment.employment_id),
              eq(schema.shiftAssignments.workDate, assignment.work_date),
              eq(schema.shiftAssignments.status, 'DRAFT'),
            ),
          );

        await uow.tx.insert(schema.shiftAssignments).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          rosterPeriodId,
          employmentId: assignment.employment_id,
          workDate: assignment.work_date,
          shiftId: assignment.shift_id,
          status: 'DRAFT',
          note: assignment.note,
        });
      }

      await uow.audit({
        action: 'scheduling.roster.assign',
        resourceType: 'roster_period',
        resourceId: rosterPeriodId,
        outcome: 'SUCCESS',
        companyId: roster.companyId,
        metadata: { count: assignments.length },
      });

      return { upserted: assignments.length };
    });
  }

  async publishRoster(rosterPeriodId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const rosters = await uow.tx
        .select()
        .from(schema.rosterPeriods)
        .where(eq(schema.rosterPeriods.id, rosterPeriodId))
        .limit(1);
      const roster = rosters[0];
      if (roster === undefined) throw AppError.notFound('roster period');
      if (roster.status === 'PUBLISHED') throw AppError.conflict('roster is already published');

      const now = this.clock.now();

      /*
       * ล้างตารางเก่าของวันเดียวกันก่อน — ตารางที่ประกาศแล้วแก้ไม่ได้ การแก้กะ
       * ของวันที่ประกาศไปแล้วจึงต้องทำผ่านตารางใบใหม่เสมอ ถ้าไม่ล้างของเดิม
       * (employment, work_date) หนึ่งคู่จะมีแถว PUBLISHED สองแถว แล้ว
       * resolveShiftId ที่ใช้ .limit(1) โดยไม่มี ORDER BY จะหยิบแบบไม่แน่นอน
       * ⇒ ผลลงเวลาวันเดียวกันอาจคิดคนละกะในการคำนวณสองครั้งติดกัน
       */
      const drafts = await uow.tx
        .select({
          employmentId: schema.shiftAssignments.employmentId,
          workDate: schema.shiftAssignments.workDate,
        })
        .from(schema.shiftAssignments)
        .where(
          and(
            eq(schema.shiftAssignments.rosterPeriodId, rosterPeriodId),
            eq(schema.shiftAssignments.status, 'DRAFT'),
          ),
        );

      for (const draft of drafts) {
        await uow.tx
          .delete(schema.shiftAssignments)
          .where(
            and(
              eq(schema.shiftAssignments.employmentId, draft.employmentId),
              eq(schema.shiftAssignments.workDate, draft.workDate),
              eq(schema.shiftAssignments.status, 'PUBLISHED'),
              ne(schema.shiftAssignments.rosterPeriodId, rosterPeriodId),
            ),
          );
      }

      const published = await uow.tx
        .update(schema.shiftAssignments)
        .set({ status: 'PUBLISHED' })
        .where(
          and(
            eq(schema.shiftAssignments.rosterPeriodId, rosterPeriodId),
            eq(schema.shiftAssignments.status, 'DRAFT'),
          ),
        )
        .returning({ id: schema.shiftAssignments.id });

      await uow.tx
        .update(schema.rosterPeriods)
        .set({
          status: 'PUBLISHED',
          publishedAt: now,
          publishedBy: this.requestContext.requirePrincipal().principalId,
        })
        .where(eq(schema.rosterPeriods.id, rosterPeriodId));

      await uow.audit({
        action: 'scheduling.roster.publish',
        resourceType: 'roster_period',
        resourceId: rosterPeriodId,
        outcome: 'SUCCESS',
        companyId: roster.companyId,
        before: { status: roster.status },
        after: { status: 'PUBLISHED', assignments_published: published.length },
      });

      await uow.publish({
        aggregateType: 'roster_period',
        aggregateId: rosterPeriodId,
        eventType: 'scheduling.roster.published',
        payload: { roster_period_id: rosterPeriodId, assignments: published.length },
      });

      return { id: rosterPeriodId, status: 'PUBLISHED', assignments_published: published.length };
    });
  }

  /**
   * ปฏิทินวันหยุดของบริษัท พร้อมวันหยุดในช่วงที่ขอ
   *
   * เดิมมีแต่ POST — ลงวันหยุดไปแล้วไม่มีทางดูว่าลงอะไรไว้บ้าง จึงลงซ้ำได้
   * โดยไม่รู้ตัว และตรวจไม่ได้ว่าทำไมวันนั้นถึงไม่ถูกนับเป็นขาดงาน
   *
   * วันหยุดผูกที่ระดับบริษัท (findHoliday จับคู่ด้วย company_id) ⇒ มีผลกับทุกคน
   */
  async listHolidayCalendars(query: {
    companyId?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const calendars = await uow.tx
        .select()
        .from(schema.holidayCalendars)
        .where(
          query.companyId === undefined
            ? undefined
            : eq(schema.holidayCalendars.companyId, query.companyId),
        )
        .orderBy(asc(schema.holidayCalendars.code));

      const items: Record<string, unknown>[] = [];
      for (const calendar of calendars) {
        const filters = [eq(schema.holidayDates.calendarId, calendar.id)];
        if (query.from !== undefined) {
          filters.push(gte(schema.holidayDates.holidayDate, query.from));
        }
        if (query.to !== undefined) {
          filters.push(lte(schema.holidayDates.holidayDate, query.to));
        }

        const dates = await uow.tx
          .select()
          .from(schema.holidayDates)
          .where(and(...filters))
          .orderBy(asc(schema.holidayDates.holidayDate));

        items.push({
          id: calendar.id,
          company_id: calendar.companyId,
          code: calendar.code,
          name: calendar.name,
          dates: dates.map((entry) => ({
            id: entry.id,
            holiday_date: entry.holidayDate,
            name: entry.name,
            paid: entry.paid,
          })),
        });
      }
      return { items };
    });
  }

  /** ลบวันหยุดหนึ่งวัน — ลงผิดวันแล้วต้องแก้ได้ ไม่งั้นค้างอยู่ตลอดไป */
  async deleteHolidayDate(holidayDateId: string): Promise<{ deleted: number }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.holidayDates)
        .where(eq(schema.holidayDates.id, holidayDateId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) throw AppError.notFound('holiday date');

      await uow.tx.delete(schema.holidayDates).where(eq(schema.holidayDates.id, holidayDateId));

      await uow.audit({
        action: 'scheduling.holiday-date.delete',
        resourceType: 'holiday_date',
        resourceId: holidayDateId,
        outcome: 'SUCCESS',
        before: { holiday_date: row.holidayDate, name: row.name },
      });

      // ผลลงเวลาที่คำนวณไปแล้วยังถือว่าวันนั้นเป็นวันหยุดอยู่ จนกว่าจะสั่งคำนวณใหม่
      return { deleted: 1 };
    });
  }

  async createHolidayCalendar(input: {
    company_id: string;
    code: string;
    name: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const id = uuidv7();
      await uow.tx.insert(schema.holidayCalendars).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        name: input.name,
      });

      await uow.audit({
        action: 'scheduling.holiday-calendar.create',
        resourceType: 'holiday_calendar',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { code: input.code },
      });

      return { id, code: input.code };
    });
  }

  async addHolidayDates(
    calendarId: string,
    dates: readonly { holiday_date: string; name: string; paid: boolean }[],
  ): Promise<{ added: number }> {
    return this.uow.run(async (uow) => {
      const calendars = await uow.tx
        .select()
        .from(schema.holidayCalendars)
        .where(eq(schema.holidayCalendars.id, calendarId))
        .limit(1);
      const calendar = calendars[0];
      if (calendar === undefined) throw AppError.notFound('holiday calendar');

      await uow.tx
        .insert(schema.holidayDates)
        .values(
          dates.map((entry) => ({
            id: uuidv7(),
            tenantId: uow.tenantId,
            calendarId,
            holidayDate: entry.holiday_date,
            name: entry.name,
            paid: entry.paid,
          })),
        )
        .onConflictDoNothing();

      await uow.audit({
        action: 'scheduling.holiday.add',
        resourceType: 'holiday_calendar',
        resourceId: calendarId,
        outcome: 'SUCCESS',
        companyId: calendar.companyId,
        metadata: { count: dates.length },
      });

      return { added: dates.length };
    });
  }
}
