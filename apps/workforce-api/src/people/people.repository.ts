import { Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

/** employment พร้อมข้อมูลบุคคล — ทุกหน้าจอที่แสดงพนักงานต้องใช้ชื่อ */
export type EmploymentWithPerson = typeof schema.employments.$inferSelect & {
  person: typeof schema.people.$inferSelect;
};

@Injectable()
export class PeopleRepository {
  // --- people ---

  async insertPerson(
    tx: Tx,
    values: typeof schema.people.$inferInsert,
  ): Promise<typeof schema.people.$inferSelect> {
    const rows = await tx.insert(schema.people).values(values).returning();
    return rows[0] as typeof schema.people.$inferSelect;
  }

  async findPersonById(tx: Tx, id: string): Promise<typeof schema.people.$inferSelect | undefined> {
    const rows = await tx.select().from(schema.people).where(eq(schema.people.id, id)).limit(1);
    return rows[0];
  }

  async findPersonByNationalIdHash(
    tx: Tx,
    hash: Buffer,
  ): Promise<typeof schema.people.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.people)
      .where(eq(schema.people.nationalIdHash, hash))
      .limit(1);
    return rows[0];
  }

  async listPeople(
    tx: Tx,
    options: { cursor: string | null; limit: number; search?: string },
  ): Promise<(typeof schema.people.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.people.id, options.cursor));
    if (options.search !== undefined) {
      const pattern = `%${options.search}%`;
      const searchCondition = or(
        ilike(schema.people.firstName, pattern),
        ilike(schema.people.lastName, pattern),
        ilike(schema.people.preferredName, pattern),
      );
      if (searchCondition !== undefined) conditions.push(searchCondition);
    }

    return tx
      .select()
      .from(schema.people)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.people.id))
      .limit(options.limit);
  }

  async updatePerson(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.people.$inferInsert>,
  ): Promise<typeof schema.people.$inferSelect | undefined> {
    const rows = await tx.update(schema.people).set(values).where(eq(schema.people.id, id)).returning();
    return rows[0];
  }

  // --- employments ---

  async insertEmployment(
    tx: Tx,
    values: typeof schema.employments.$inferInsert,
  ): Promise<typeof schema.employments.$inferSelect> {
    const rows = await tx.insert(schema.employments).values(values).returning();
    return rows[0] as typeof schema.employments.$inferSelect;
  }

  async findEmploymentById(tx: Tx, id: string): Promise<EmploymentWithPerson | undefined> {
    const rows = await tx
      .select({ employment: schema.employments, person: schema.people })
      .from(schema.employments)
      .innerJoin(schema.people, eq(schema.employments.personId, schema.people.id))
      .where(eq(schema.employments.id, id))
      .limit(1);

    const row = rows[0];
    return row === undefined ? undefined : { ...row.employment, person: row.person };
  }

  /**
   * ล็อกแถวการจ้างก่อนแก้ข้อมูล effective-dated ที่ผูกกับมัน
   *
   * เป็นสิ่งที่ปิดช่องแข่งกันของ trigger ตรวจ overlap: request สองตัวที่เขียน
   * ช่วงเวลาทับกันพร้อมกันจะถูกบังคับให้เข้าคิวที่แถวนี้ (ADR-0012)
   */
  async lockEmployment(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.employments.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.employments)
      .where(eq(schema.employments.id, id))
      .limit(1)
      .for('update');
    return rows[0];
  }

  async listEmployments(
    tx: Tx,
    options: {
      cursor: string | null;
      limit: number;
      companyId?: string;
      status?: string;
      personId?: string;
      /** จำกัดเฉพาะการจ้างที่ยังไม่สิ้นสุด ณ วันที่นี้ */
      activeOn?: string;
      /** จำกัดตาม data scope ของผู้เรียก */
      employmentIds?: string[];
    },
  ): Promise<EmploymentWithPerson[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.employments.id, options.cursor));
    if (options.companyId !== undefined)
      conditions.push(eq(schema.employments.companyId, options.companyId));
    if (options.status !== undefined) conditions.push(eq(schema.employments.status, options.status));
    if (options.personId !== undefined)
      conditions.push(eq(schema.employments.personId, options.personId));
    if (options.activeOn !== undefined) {
      const stillEmployed = or(
        isNull(schema.employments.terminatedOn),
        sql`${schema.employments.terminatedOn} >= ${options.activeOn}`,
      );
      if (stillEmployed !== undefined) conditions.push(stillEmployed);
      conditions.push(sql`${schema.employments.hiredOn} <= ${options.activeOn}`);
    }
    if (options.employmentIds !== undefined) {
      // scope ที่ไม่ครอบคลุมใครเลยต้องคืนว่าง ไม่ใช่คืนทุกแถว
      if (options.employmentIds.length === 0) return [];
      conditions.push(inArray(schema.employments.id, options.employmentIds));
    }

    const rows = await tx
      .select({ employment: schema.employments, person: schema.people })
      .from(schema.employments)
      .innerJoin(schema.people, eq(schema.employments.personId, schema.people.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.employments.employeeCode))
      .limit(options.limit);

    return rows.map((row) => ({ ...row.employment, person: row.person }));
  }

  async updateEmployment(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.employments.$inferInsert>,
  ): Promise<typeof schema.employments.$inferSelect | undefined> {
    const rows = await tx
      .update(schema.employments)
      .set(values)
      .where(eq(schema.employments.id, id))
      .returning();
    return rows[0];
  }

  // --- assignments (effective-dated) ---

  async insertAssignment(
    tx: Tx,
    values: typeof schema.employmentAssignments.$inferInsert,
  ): Promise<typeof schema.employmentAssignments.$inferSelect> {
    const rows = await tx.insert(schema.employmentAssignments).values(values).returning();
    return rows[0] as typeof schema.employmentAssignments.$inferSelect;
  }

  async listAssignments(
    tx: Tx,
    employmentId: string,
  ): Promise<(typeof schema.employmentAssignments.$inferSelect)[]> {
    return tx
      .select()
      .from(schema.employmentAssignments)
      .where(eq(schema.employmentAssignments.employmentId, employmentId))
      .orderBy(desc(schema.employmentAssignments.effectiveFrom));
  }

  async findOpenAssignment(
    tx: Tx,
    employmentId: string,
  ): Promise<typeof schema.employmentAssignments.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.employmentAssignments)
      .where(
        and(
          eq(schema.employmentAssignments.employmentId, employmentId),
          isNull(schema.employmentAssignments.effectiveTo),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async closeAssignment(tx: Tx, id: string, effectiveTo: string): Promise<void> {
    await tx
      .update(schema.employmentAssignments)
      .set({ effectiveTo })
      .where(eq(schema.employmentAssignments.id, id));
  }

  /** employment ที่มี principal นี้เป็นผู้บังคับบัญชา ณ วันที่ระบุ — ใช้ resolve scope TEAM */
  async listManagedEmploymentIds(
    tx: Tx,
    managerEmploymentId: string,
    asOf: string,
  ): Promise<string[]> {
    const rows = await tx
      .select({ employmentId: schema.employmentAssignments.employmentId })
      .from(schema.employmentAssignments)
      .where(
        and(
          eq(schema.employmentAssignments.managerEmploymentId, managerEmploymentId),
          sql`${schema.employmentAssignments.effectiveFrom} <= ${asOf}`,
          or(
            isNull(schema.employmentAssignments.effectiveTo),
            sql`${schema.employmentAssignments.effectiveTo} >= ${asOf}`,
          ),
        ),
      );
    return [...new Set(rows.map((row) => row.employmentId))];
  }
}
