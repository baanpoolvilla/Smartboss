import { Injectable } from '@nestjs/common';
import type { Compensation, CreateCompensationInput, UpdateCompensationInput } from '@workforce/contracts';
import { schema, type Tx } from '@workforce/db';
import { AppError, EffectivePeriod, LocalDate, Money, uuidv7 } from '@workforce/domain';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { PeopleRepository } from '../people/people.repository';
import { buildPage, fetchLimit, type PageResult } from '../shared/pagination';

type CompensationRow = typeof schema.compensationRates.$inferSelect;

@Injectable()
export class CompensationRepository {
  async insert(tx: Tx, values: typeof schema.compensationRates.$inferInsert): Promise<CompensationRow> {
    const rows = await tx.insert(schema.compensationRates).values(values).returning();
    return rows[0] as CompensationRow;
  }

  async list(
    tx: Tx,
    options: { employmentId: string; cursor: string | null; limit: number; asOf?: string },
  ): Promise<CompensationRow[]> {
    const conditions = [eq(schema.compensationRates.employmentId, options.employmentId)];
    if (options.cursor !== null) conditions.push(gt(schema.compensationRates.id, options.cursor));

    if (options.asOf !== undefined) {
      conditions.push(sql`${schema.compensationRates.effectiveFrom} <= ${options.asOf}`);
      const stillEffective = or(
        isNull(schema.compensationRates.effectiveTo),
        sql`${schema.compensationRates.effectiveTo} >= ${options.asOf}`,
      );
      if (stillEffective !== undefined) conditions.push(stillEffective);
    }

    return tx
      .select()
      .from(schema.compensationRates)
      .where(and(...conditions))
      .orderBy(options.asOf === undefined ? asc(schema.compensationRates.id) : desc(schema.compensationRates.effectiveFrom))
      .limit(options.limit);
  }

  async findOpen(tx: Tx, employmentId: string): Promise<CompensationRow | undefined> {
    const rows = await tx
      .select()
      .from(schema.compensationRates)
      .where(
        and(
          eq(schema.compensationRates.employmentId, employmentId),
          isNull(schema.compensationRates.effectiveTo),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findById(tx: Tx, id: string): Promise<CompensationRow | undefined> {
    const rows = await tx.select().from(schema.compensationRates).where(eq(schema.compensationRates.id, id)).limit(1);
    return rows[0];
  }

  async update(
    tx: Tx,
    id: string,
    values: Partial<Pick<CompensationRow, 'payBasis' | 'amount' | 'note'>>,
  ): Promise<CompensationRow> {
    const rows = await tx.update(schema.compensationRates).set(values).where(eq(schema.compensationRates.id, id)).returning();
    return rows[0] as CompensationRow;
  }

  async close(tx: Tx, id: string, effectiveTo: string): Promise<void> {
    await tx
      .update(schema.compensationRates)
      .set({ effectiveTo })
      .where(eq(schema.compensationRates.id, id));
  }
}

/**
 * ฐานค่าจ้างแบบ effective-dated
 *
 * ระบบเดิมเก็บเป็นคอลัมน์เดียวใน `fp_users` แล้ว UPDATE ทับ ทำให้คำนวณงวดเก่าใหม่
 * ได้ผลต่างจากตอนปิดงวด (spec §3.3 P9) ที่นี่การ "แก้เงินเดือน" คือการปิดช่วงเดิม
 * แล้วเปิดช่วงใหม่ในทรานแซกชันเดียว — ประวัติเดิมยังอ่านได้เสมอ (ADR-0012)
 */
@Injectable()
export class CompensationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: CompensationRepository,
    private readonly people: PeopleRepository,
  ) {}

  async update(rateId: string, input: UpdateCompensationInput): Promise<Compensation> {
    return updateCompensationRate({ uow: this.uow, repository: this.repository, people: this.people }, rateId, input);
  }

  async list(query: {
    employmentId: string;
    cursor: string | null;
    limit: number;
    asOf?: string;
  }): Promise<PageResult<Compensation>> {
    return this.uow.run(async (uow) => {
      const employment = await this.people.findEmploymentById(uow.tx, query.employmentId);
      if (employment === undefined) throw AppError.notFound('employment');

      const rows = await this.repository.list(uow.tx, {
        employmentId: query.employmentId,
        cursor: query.cursor,
        limit: fetchLimit(query.limit),
        ...(query.asOf === undefined ? {} : { asOf: query.asOf }),
      });

      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toCompensation), next_cursor: page.next_cursor };
    });
  }

  async create(input: CreateCompensationInput): Promise<Compensation> {
    return this.uow.run(async (uow) => {
      const employment = await this.people.lockEmployment(uow.tx, input.employment_id);
      if (employment === undefined) throw AppError.notFound('employment');

      const period = EffectivePeriod.parse(input.effective_from, input.effective_to);
      if (period.from.isBefore(LocalDate.parse(employment.hiredOn))) {
        throw AppError.validation('effective_from must not be before the hire date');
      }

      // parse ผ่าน Money เพื่อบังคับว่าเป็น decimal ที่ scale ไม่เกิน 4 ตั้งแต่ต้นทาง
      const amount = Money.of(input.amount, input.currency);
      if (amount.isNegative()) throw AppError.validation('amount must not be negative');

      if (input.supersede_current) {
        const open = await this.repository.findOpen(uow.tx, input.employment_id);
        if (open !== undefined) {
          const openPeriod = EffectivePeriod.parse(open.effectiveFrom, null);
          if (!openPeriod.from.isBefore(period.from)) {
            throw AppError.validation(
              'cannot supersede a rate that starts on or after the new effective_from',
            );
          }
          const closed = openPeriod.closeBefore(period.from);
          await this.repository.close(uow.tx, open.id, closed.to?.toString() as string);
        }
      }

      const row = await this.repository.insert(uow.tx, {
        id: uuidv7(),
        tenantId: uow.tenantId,
        employmentId: input.employment_id,
        payBasis: input.pay_basis,
        amount: amount.toString(),
        currency: input.currency,
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to,
        provenance: 'MANUAL',
        approvalReference: input.approval_reference,
        note: input.note,
      });

      await uow.audit({
        action: 'compensation.rate.create',
        resourceType: 'compensation_rate',
        resourceId: row.id,
        resourceVersion: row.version,
        outcome: 'SUCCESS',
        companyId: employment.companyId,
        after: {
          employment_id: row.employmentId,
          pay_basis: row.payBasis,
          amount: row.amount,
          currency: row.currency,
          effective_from: row.effectiveFrom,
          effective_to: row.effectiveTo,
          approval_reference: row.approvalReference,
        },
      });

      await uow.publish({
        aggregateType: 'employment',
        aggregateId: row.employmentId,
        eventType: 'compensation.rate.created',
        payload: {
          employment_id: row.employmentId,
          effective_from: row.effectiveFrom,
          pay_basis: row.payBasis,
        },
      });

      return toCompensation(row);
    });
  }
}

/**
 * แก้แถวที่ลงผิด (ยอด/ฐาน/หมายเหตุ) — ช่วงวันที่ไม่เปลี่ยน · เก็บ audit ค่าก่อน/หลัง + เหตุผล (ผู้ใช้ 26/11/2569)
 * แยกเป็นฟังก์ชันของ service เพื่อไม่ให้ไปปนกับ create ที่ปิดช่วงเดิม/เปิดช่วงใหม่
 */
export async function updateCompensationRate(
  service: { uow: UnitOfWork; repository: CompensationRepository; people: PeopleRepository },
  rateId: string,
  input: UpdateCompensationInput,
): Promise<Compensation> {
  return service.uow.run(async (uow) => {
    const before = await service.repository.findById(uow.tx, rateId);
    if (before === undefined) throw AppError.notFound('compensation_rate');
    if (input.expected_version !== undefined && input.expected_version !== before.version) {
      throw AppError.conflict('compensation rate was changed by someone else — reload and try again');
    }
    const employment = await service.people.lockEmployment(uow.tx, before.employmentId);
    if (employment === undefined) throw AppError.notFound('employment');

    const values: Partial<Pick<CompensationRow, 'payBasis' | 'amount' | 'note'>> = {};
    if (input.pay_basis !== undefined) values.payBasis = input.pay_basis;
    if (input.amount !== undefined) {
      const amount = Money.of(input.amount, before.currency);
      if (amount.isNegative()) throw AppError.validation('amount must not be negative');
      values.amount = amount.toString();
    }
    if (input.note !== undefined) values.note = input.note;

    const after = await service.repository.update(uow.tx, rateId, values);
    await uow.audit({
      action: 'compensation.rate.update',
      resourceType: 'compensation_rate',
      resourceId: after.id,
      resourceVersion: after.version,
      outcome: 'SUCCESS',
      companyId: employment.companyId,
      reason: input.reason,
      before: { employment_id: before.employmentId, pay_basis: before.payBasis, amount: before.amount, note: before.note, effective_from: before.effectiveFrom, effective_to: before.effectiveTo },
      after: { employment_id: after.employmentId, pay_basis: after.payBasis, amount: after.amount, note: after.note, effective_from: after.effectiveFrom, effective_to: after.effectiveTo },
    });
    await uow.publish({
      aggregateType: 'employment',
      aggregateId: after.employmentId,
      eventType: 'compensation.rate.updated',
      payload: { employment_id: after.employmentId, effective_from: after.effectiveFrom, pay_basis: after.payBasis },
    });
    return toCompensation(after);
  });
}

function toCompensation(row: CompensationRow): Compensation {
  return {
    id: row.id,
    employment_id: row.employmentId,
    pay_basis: row.payBasis as Compensation['pay_basis'],
    // เงินออก API เป็น string เสมอ (spec §13, ADR-0007)
    amount: row.amount,
    currency: row.currency,
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
    provenance: row.provenance as Compensation['provenance'],
    approval_reference: row.approvalReference,
    note: row.note,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}
