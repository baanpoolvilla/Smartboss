import { Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { and, asc, eq, gt, type SQL } from 'drizzle-orm';

/**
 * การเข้าถึงข้อมูลของ organization module
 *
 * ทุก method รับ `tx` ที่มาจาก UnitOfWork ซึ่งตั้ง tenant GUC และ SET LOCAL ROLE
 * ไว้แล้ว — repository จึงไม่ต้อง (และต้องไม่) ใส่ `WHERE tenant_id = ...` เอง
 * การกรอง tenant เป็นหน้าที่ของ RLS (ADR-0005 ชั้น 2–3)
 */
@Injectable()
export class OrganizationRepository {
  // --- companies ---

  async insertCompany(
    tx: Tx,
    values: typeof schema.companies.$inferInsert,
  ): Promise<typeof schema.companies.$inferSelect> {
    const rows = await tx.insert(schema.companies).values(values).returning();
    return rows[0] as typeof schema.companies.$inferSelect;
  }

  async findCompanyById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.companies.$inferSelect | undefined> {
    const rows = await tx.select().from(schema.companies).where(eq(schema.companies.id, id)).limit(1);
    return rows[0];
  }

  async findCompanyByCode(
    tx: Tx,
    code: string,
  ): Promise<typeof schema.companies.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.code, code))
      .limit(1);
    return rows[0];
  }

  async listCompanies(
    tx: Tx,
    options: { cursor: string | null; limit: number; status?: string },
  ): Promise<(typeof schema.companies.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.companies.id, options.cursor));
    if (options.status !== undefined) conditions.push(eq(schema.companies.status, options.status));

    return tx
      .select()
      .from(schema.companies)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.companies.id))
      .limit(options.limit);
  }

  async updateCompany(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.companies.$inferInsert>,
  ): Promise<typeof schema.companies.$inferSelect | undefined> {
    const rows = await tx
      .update(schema.companies)
      .set(values)
      .where(eq(schema.companies.id, id))
      .returning();
    return rows[0];
  }

  // --- org units ---

  async insertOrgUnit(
    tx: Tx,
    values: typeof schema.orgUnits.$inferInsert,
  ): Promise<typeof schema.orgUnits.$inferSelect> {
    const rows = await tx.insert(schema.orgUnits).values(values).returning();
    return rows[0] as typeof schema.orgUnits.$inferSelect;
  }

  async findOrgUnitById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.orgUnits.$inferSelect | undefined> {
    const rows = await tx.select().from(schema.orgUnits).where(eq(schema.orgUnits.id, id)).limit(1);
    return rows[0];
  }

  async listOrgUnits(
    tx: Tx,
    options: { cursor: string | null; limit: number; companyId?: string },
  ): Promise<(typeof schema.orgUnits.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.orgUnits.id, options.cursor));
    if (options.companyId !== undefined)
      conditions.push(eq(schema.orgUnits.companyId, options.companyId));

    return tx
      .select()
      .from(schema.orgUnits)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.orgUnits.id))
      .limit(options.limit);
  }

  // --- sites ---

  async insertSite(
    tx: Tx,
    values: typeof schema.sites.$inferInsert,
  ): Promise<typeof schema.sites.$inferSelect> {
    const rows = await tx.insert(schema.sites).values(values).returning();
    return rows[0] as typeof schema.sites.$inferSelect;
  }

  async findSiteById(tx: Tx, id: string): Promise<typeof schema.sites.$inferSelect | undefined> {
    const rows = await tx.select().from(schema.sites).where(eq(schema.sites.id, id)).limit(1);
    return rows[0];
  }

  async listSites(
    tx: Tx,
    options: { cursor: string | null; limit: number; companyId?: string },
  ): Promise<(typeof schema.sites.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.sites.id, options.cursor));
    if (options.companyId !== undefined) conditions.push(eq(schema.sites.companyId, options.companyId));

    return tx
      .select()
      .from(schema.sites)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.sites.id))
      .limit(options.limit);
  }

  // --- positions ---

  async insertPosition(
    tx: Tx,
    values: typeof schema.positions.$inferInsert,
  ): Promise<typeof schema.positions.$inferSelect> {
    const rows = await tx.insert(schema.positions).values(values).returning();
    return rows[0] as typeof schema.positions.$inferSelect;
  }

  async listPositions(
    tx: Tx,
    options: { cursor: string | null; limit: number; companyId?: string },
  ): Promise<(typeof schema.positions.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.positions.id, options.cursor));
    if (options.companyId !== undefined)
      conditions.push(eq(schema.positions.companyId, options.companyId));

    return tx
      .select()
      .from(schema.positions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.positions.id))
      .limit(options.limit);
  }
}
