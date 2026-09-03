import { Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { and, asc, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

@Injectable()
export class AttendanceRepository {
  /**
   * การลงเวลาของวันหนึ่ง **ทีละครั้ง ไม่รวบ** — สำหรับหน้า Timeline
   *
   * ต่างจาก listBoardScans ที่ยุบเหลือคนละแถว (เข้าครั้งแรก/ออกครั้งสุดท้าย)
   * ตรงที่หน้านี้ต้องเห็นทุกครั้งที่แตะเครื่องจริง ๆ เรียงตามเวลา พร้อมบอกว่า
   * ครั้งนั้นเป็นเข้า/ออก/พัก และลงผ่านช่องทางไหน (เครื่องสแกน/มือถือ/เว็บ)
   * ซึ่งเป็นข้อมูลที่การรวบทำให้หายไปหมด
   */
  async listDayTimeEvents(
    tx: Tx,
    workDate: string,
  ): Promise<
    {
      id: string;
      employmentId: string;
      displayName: string;
      employeeCode: string;
      capturedAt: string;
      timeZone: string;
      eventIntent: string;
      sourceType: string;
    }[]
  > {
    const rows = await tx
      .select({
        id: schema.rawTimeEvents.id,
        employmentId: schema.rawTimeEvents.employmentId,
        capturedAt: schema.rawTimeEvents.capturedAt,
        timeZone: schema.rawTimeEvents.timeZone,
        eventIntent: schema.rawTimeEvents.eventIntent,
        sourceType: schema.rawTimeEvents.sourceType,
        employeeCode: schema.employments.employeeCode,
        firstName: schema.people.firstName,
        lastName: schema.people.lastName,
        preferredName: schema.people.preferredName,
      })
      .from(schema.rawTimeEvents)
      .innerJoin(
        schema.employments,
        eq(schema.employments.id, schema.rawTimeEvents.employmentId),
      )
      .innerJoin(schema.people, eq(schema.people.id, schema.employments.personId))
      .where(
        and(
          sql`${schema.rawTimeEvents.capturedAt} >= ${`${workDate}T00:00:00Z`}`,
          sql`${schema.rawTimeEvents.capturedAt} <= ${`${workDate}T23:59:59Z`}`,
          sql`${schema.rawTimeEvents.employmentId} is not null`,
          // แถวที่ถูกกักไว้ยังไม่ผ่านการตรวจ ไม่ควรโผล่บนกระดานที่ทุกคนเห็น
          eq(schema.rawTimeEvents.status, 'ACCEPTED'),
        ),
      )
      // ใหม่สุดอยู่บน — คนเปิดดูอยากรู้ว่า "เมื่อกี้ใครเพิ่งตอก" ก่อนเรื่องเช้านี้
      .orderBy(desc(schema.rawTimeEvents.capturedAt));

    return rows.map((row) => {
      const preferred = (row.preferredName ?? '').trim();
      return {
        id: row.id,
        employmentId: row.employmentId!,
        displayName:
          preferred === '' ? `${row.firstName} ${row.lastName ?? ''}`.trim() : preferred,
        employeeCode: row.employeeCode,
        capturedAt: new Date(row.capturedAt).toISOString(),
        timeZone: row.timeZone,
        eventIntent: row.eventIntent,
        sourceType: row.sourceType,
      };
    });
  }

  /** นโยบายที่มีผล ณ วันที่ระบุ — point-in-time เสมอ (ADR-0012) */
  /**
   * การสแกนของวันหนึ่ง สรุปเป็นคนละแถว — ครั้งแรก/ครั้งล่าสุด/จำนวนครั้ง
   *
   * คนหนึ่งคนสแกนหลายครั้งต่อวัน (เข้า/ออก/พัก) กระดานต้องการแถวเดียวต่อคน
   * จึงรวบที่ฐานข้อมูลแทนดึงมาทั้งหมดแล้วยุบในแอป
   *
   * เอาเฉพาะแถวที่จับคู่กับพนักงานได้ — slot ที่ยังไม่ผูกกับใครไม่มีประโยชน์
   * กับกระดานทีม (ผู้ดูแลดูได้จากรายการสแกนดิบ)
   */
  async listBoardScans(
    tx: Tx,
    workDate: string,
  ): Promise<
    {
      employmentId: string;
      companyId: string;
      timeZone: string;
      displayName: string;
      employeeCode: string;
      firstAt: string;
      lastAt: string;
      scanCount: number;
    }[]
  > {
    const rows = await tx
      .select({
        employmentId: schema.rawTimeEvents.employmentId,
        companyId: schema.rawTimeEvents.companyId,
        timeZone: schema.rawTimeEvents.timeZone,
        employeeCode: schema.employments.employeeCode,
        firstName: schema.people.firstName,
        lastName: schema.people.lastName,
        preferredName: schema.people.preferredName,
        firstAt: sql<string>`min(${schema.rawTimeEvents.capturedAt})`,
        lastAt: sql<string>`max(${schema.rawTimeEvents.capturedAt})`,
        scanCount: sql<number>`count(*)::int`,
      })
      .from(schema.rawTimeEvents)
      .innerJoin(
        schema.employments,
        eq(schema.employments.id, schema.rawTimeEvents.employmentId),
      )
      .innerJoin(schema.people, eq(schema.people.id, schema.employments.personId))
      .where(
        and(
          sql`${schema.rawTimeEvents.capturedAt} >= ${`${workDate}T00:00:00Z`}`,
          sql`${schema.rawTimeEvents.capturedAt} <= ${`${workDate}T23:59:59Z`}`,
          sql`${schema.rawTimeEvents.employmentId} is not null`,
        ),
      )
      .groupBy(
        schema.rawTimeEvents.employmentId,
        schema.rawTimeEvents.companyId,
        schema.rawTimeEvents.timeZone,
        schema.employments.employeeCode,
        schema.people.firstName,
        schema.people.lastName,
        schema.people.preferredName,
      );

    return rows.map((row) => {
      const preferred = (row.preferredName ?? '').trim();
      return {
        employmentId: row.employmentId!,
        companyId: row.companyId,
        timeZone: row.timeZone,
        displayName:
          preferred === '' ? `${row.firstName} ${row.lastName ?? ''}`.trim() : preferred,
        employeeCode: row.employeeCode,
        firstAt: new Date(row.firstAt).toISOString(),
        lastAt: new Date(row.lastAt).toISOString(),
        scanCount: row.scanCount,
      };
    });
  }

  async resolveWorkPolicy(
    tx: Tx,
    companyId: string,
    asOf: string,
  ): Promise<typeof schema.workPolicies.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.workPolicies)
      .where(
        and(
          eq(schema.workPolicies.companyId, companyId),
          sql`${schema.workPolicies.effectiveFrom} <= ${asOf}`,
          or(
            isNull(schema.workPolicies.effectiveTo),
            sql`${schema.workPolicies.effectiveTo} >= ${asOf}`,
          ),
        ),
      )
      .orderBy(desc(schema.workPolicies.effectiveFrom))
      .limit(1);
    return rows[0];
  }

  async findShiftWithBreaks(
    tx: Tx,
    shiftId: string,
  ): Promise<
    | {
        shift: typeof schema.shiftDefinitions.$inferSelect;
        breaks: (typeof schema.shiftBreakRules.$inferSelect)[];
      }
    | undefined
  > {
    const shifts = await tx
      .select()
      .from(schema.shiftDefinitions)
      .where(eq(schema.shiftDefinitions.id, shiftId))
      .limit(1);
    const shift = shifts[0];
    if (shift === undefined) return undefined;

    const breaks = await tx
      .select()
      .from(schema.shiftBreakRules)
      .where(eq(schema.shiftBreakRules.shiftId, shiftId))
      .orderBy(asc(schema.shiftBreakRules.startMinutes));

    return { shift, breaks };
  }

  /**
   * หากะของวันนั้น
   *
   * ลำดับตาม spec §7.1: roster ที่ publish แล้วชนะ recurring pattern
   * roster ที่ยังเป็น draft ต้องไม่มีผล — พนักงานยังไม่เห็นด้วยซ้ำ
   */
  async resolveShiftId(
    tx: Tx,
    employmentId: string,
    workDate: string,
  ): Promise<{ shiftId: string | null; source: 'ROSTER' | 'PATTERN' | 'NONE' }> {
    const assignments = await tx
      .select()
      .from(schema.shiftAssignments)
      .where(
        and(
          eq(schema.shiftAssignments.employmentId, employmentId),
          eq(schema.shiftAssignments.workDate, workDate),
          eq(schema.shiftAssignments.status, 'PUBLISHED'),
        ),
      )
      .limit(1);

    const assignment = assignments[0];
    if (assignment !== undefined) return { shiftId: assignment.shiftId, source: 'ROSTER' };

    const patterns = await tx
      .select()
      .from(schema.recurringWorkPatterns)
      .where(
        and(
          eq(schema.recurringWorkPatterns.employmentId, employmentId),
          sql`${schema.recurringWorkPatterns.effectiveFrom} <= ${workDate}`,
          or(
            isNull(schema.recurringWorkPatterns.effectiveTo),
            sql`${schema.recurringWorkPatterns.effectiveTo} >= ${workDate}`,
          ),
        ),
      )
      .orderBy(desc(schema.recurringWorkPatterns.effectiveFrom))
      .limit(1);

    const pattern = patterns[0];
    if (pattern === undefined) return { shiftId: null, source: 'NONE' };

    const dayOfWeek = new Date(`${workDate}T00:00:00Z`).getUTCDay();
    const byDay = [
      pattern.sundayShiftId,
      pattern.mondayShiftId,
      pattern.tuesdayShiftId,
      pattern.wednesdayShiftId,
      pattern.thursdayShiftId,
      pattern.fridayShiftId,
      pattern.saturdayShiftId,
    ];
    return { shiftId: byDay[dayOfWeek] ?? null, source: 'PATTERN' };
  }

  async findHoliday(
    tx: Tx,
    companyId: string,
    workDate: string,
  ): Promise<typeof schema.holidayDates.$inferSelect | undefined> {
    const rows = await tx
      .select({ holiday: schema.holidayDates })
      .from(schema.holidayDates)
      .innerJoin(
        schema.holidayCalendars,
        eq(schema.holidayCalendars.id, schema.holidayDates.calendarId),
      )
      .where(
        and(
          eq(schema.holidayCalendars.companyId, companyId),
          eq(schema.holidayDates.holidayDate, workDate),
        ),
      )
      .limit(1);
    return rows[0]?.holiday;
  }

  /**
   * raw event ของวันทำงานหนึ่ง
   *
   * ใช้หน้าต่างกว้างกว่าหนึ่งวันเพราะกะข้ามคืน: punch ตอนตี 6 ของวันถัดไป
   * ยังเป็นของ work_date เดิม (spec §7.1)
   */
  async listEventsForWindow(
    tx: Tx,
    employmentId: string,
    from: Date,
    to: Date,
  ): Promise<(typeof schema.rawTimeEvents.$inferSelect)[]> {
    return tx
      .select()
      .from(schema.rawTimeEvents)
      .where(
        and(
          eq(schema.rawTimeEvents.employmentId, employmentId),
          eq(schema.rawTimeEvents.status, 'ACCEPTED'),
          gte(schema.rawTimeEvents.capturedAt, from),
          lte(schema.rawTimeEvents.capturedAt, to),
        ),
      )
      .orderBy(asc(schema.rawTimeEvents.capturedAt));
  }

  async listApprovedAdjustments(
    tx: Tx,
    employmentId: string,
    workDate: string,
  ): Promise<(typeof schema.timeEventAdjustments.$inferSelect)[]> {
    return tx
      .select()
      .from(schema.timeEventAdjustments)
      .where(
        and(
          eq(schema.timeEventAdjustments.employmentId, employmentId),
          eq(schema.timeEventAdjustments.workDate, workDate),
          eq(schema.timeEventAdjustments.status, 'APPROVED'),
        ),
      );
  }

  /** ปิด version เดิมก่อนเขียน version ใหม่ — ของเดิมยังอ่านได้ (ADR-0012) */
  async supersedeCurrentResult(
    tx: Tx,
    employmentId: string,
    workDate: string,
  ): Promise<number> {
    const rows = await tx
      .update(schema.attendanceResults)
      .set({ isCurrent: false })
      .where(
        and(
          eq(schema.attendanceResults.employmentId, employmentId),
          eq(schema.attendanceResults.workDate, workDate),
          eq(schema.attendanceResults.isCurrent, true),
        ),
      )
      .returning({ version: schema.attendanceResults.resultVersion });
    return rows[0]?.version ?? 0;
  }

  async insertResult(
    tx: Tx,
    values: typeof schema.attendanceResults.$inferInsert,
  ): Promise<typeof schema.attendanceResults.$inferSelect> {
    const rows = await tx.insert(schema.attendanceResults).values(values).returning();
    return rows[0] as typeof schema.attendanceResults.$inferSelect;
  }

  async insertPunches(
    tx: Tx,
    values: (typeof schema.attendanceResultPunches.$inferInsert)[],
  ): Promise<void> {
    if (values.length === 0) return;
    await tx.insert(schema.attendanceResultPunches).values(values);
  }

  async insertExceptions(
    tx: Tx,
    values: (typeof schema.attendanceExceptions.$inferInsert)[],
  ): Promise<void> {
    if (values.length === 0) return;
    await tx.insert(schema.attendanceExceptions).values(values);
  }

  /** exception ของ version เก่าไม่ควรค้างในคิวหลังคำนวณใหม่ */
  async closeSupersededExceptions(
    tx: Tx,
    employmentId: string,
    workDate: string,
  ): Promise<void> {
    await tx
      .delete(schema.attendanceExceptions)
      .where(
        and(
          eq(schema.attendanceExceptions.employmentId, employmentId),
          eq(schema.attendanceExceptions.workDate, workDate),
          eq(schema.attendanceExceptions.status, 'OPEN'),
        ),
      );
  }

  async findCurrentResult(
    tx: Tx,
    employmentId: string,
    workDate: string,
  ): Promise<typeof schema.attendanceResults.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.attendanceResults)
      .where(
        and(
          eq(schema.attendanceResults.employmentId, employmentId),
          eq(schema.attendanceResults.workDate, workDate),
          eq(schema.attendanceResults.isCurrent, true),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listResults(
    tx: Tx,
    options: { employmentId?: string; companyId?: string; from: string; to: string },
  ): Promise<(typeof schema.attendanceResults.$inferSelect)[]> {
    const conditions: SQL[] = [
      eq(schema.attendanceResults.isCurrent, true),
      sql`${schema.attendanceResults.workDate} >= ${options.from}`,
      sql`${schema.attendanceResults.workDate} <= ${options.to}`,
    ];
    if (options.employmentId !== undefined)
      conditions.push(eq(schema.attendanceResults.employmentId, options.employmentId));
    if (options.companyId !== undefined)
      conditions.push(eq(schema.attendanceResults.companyId, options.companyId));

    return tx
      .select()
      .from(schema.attendanceResults)
      .where(and(...conditions))
      .orderBy(asc(schema.attendanceResults.workDate));
  }

  async listExceptions(
    tx: Tx,
    options: { companyId?: string; employmentId?: string; status?: string; from?: string; to?: string },
  ): Promise<(typeof schema.attendanceExceptions.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.companyId !== undefined)
      conditions.push(eq(schema.attendanceExceptions.companyId, options.companyId));
    if (options.employmentId !== undefined)
      conditions.push(eq(schema.attendanceExceptions.employmentId, options.employmentId));
    if (options.status !== undefined)
      conditions.push(eq(schema.attendanceExceptions.status, options.status));
    if (options.from !== undefined)
      conditions.push(sql`${schema.attendanceExceptions.workDate} >= ${options.from}`);
    if (options.to !== undefined)
      conditions.push(sql`${schema.attendanceExceptions.workDate} <= ${options.to}`);

    return tx
      .select()
      .from(schema.attendanceExceptions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.attendanceExceptions.workDate))
      .limit(200);
  }

  async findExceptionById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.attendanceExceptions.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.attendanceExceptions)
      .where(eq(schema.attendanceExceptions.id, id))
      .limit(1);
    return rows[0];
  }

  async updateException(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.attendanceExceptions.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(schema.attendanceExceptions)
      .set(values)
      .where(eq(schema.attendanceExceptions.id, id));
  }

  async insertAdjustment(
    tx: Tx,
    values: typeof schema.timeEventAdjustments.$inferInsert,
  ): Promise<typeof schema.timeEventAdjustments.$inferSelect> {
    const rows = await tx.insert(schema.timeEventAdjustments).values(values).returning();
    return rows[0] as typeof schema.timeEventAdjustments.$inferSelect;
  }

  async findAdjustmentById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.timeEventAdjustments.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.timeEventAdjustments)
      .where(eq(schema.timeEventAdjustments.id, id))
      .limit(1);
    return rows[0];
  }

  async updateAdjustment(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.timeEventAdjustments.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(schema.timeEventAdjustments)
      .set(values)
      .where(eq(schema.timeEventAdjustments.id, id));
  }
}
