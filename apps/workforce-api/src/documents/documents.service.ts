import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@workforce/config';
import { schema } from '@workforce/db';
import { AppError, Money, uuidv7, type Clock } from '@workforce/domain';
import { isLocked, type PayrollRunStatus } from '@workforce/payroll-engine';
import { and, asc, eq } from 'drizzle-orm';
import { FieldEncryptionService } from '../infrastructure/crypto/field-encryption';
import { buildObjectKey, type ObjectStorage } from '../infrastructure/storage/object-storage';
import { UnitOfWork } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { APP_CONFIG, CLOCK, OBJECT_STORAGE } from '../shared/tokens';

interface RegisterRow {
  employee_code: string;
  employment_id: string;
  gross: string;
  total_deduction: string;
  employer_contribution: string;
  net_pay: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly encryption: FieldEncryptionService,
    private readonly requestContext: RequestContextService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * ออกสลิปเงินเดือนจาก run ที่ล็อกแล้วเท่านั้น
   *
   * spec §19.5: ยอดบนสลิปต้องเท่ากับผลลัพธ์ที่ล็อก — ออกก่อนล็อกแปลว่าตัวเลข
   * ยังเปลี่ยนได้ แล้วสลิปจะไม่ตรงกับเงินที่จ่ายจริง
   */
  async publishPayslips(runId: string): Promise<{ published: number }> {
    return this.uow.run(async (uow) => {
      const runs = await uow.tx
        .select()
        .from(schema.payrollRuns)
        .where(eq(schema.payrollRuns.id, runId))
        .limit(1);
      const run = runs[0];
      if (run === undefined) throw AppError.notFound('payroll run');

      if (!isLocked(run.status as PayrollRunStatus)) {
        throw AppError.conflict('payslips can only be published from a locked payroll run', {
          meta: { status: run.status },
        });
      }

      const results = await uow.tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(eq(schema.payrollEmployeeResults.runId, runId))
        .orderBy(asc(schema.payrollEmployeeResults.employmentId));

      let published = 0;
      for (const result of results) {
        const lines = await uow.tx
          .select()
          .from(schema.payrollLines)
          .where(eq(schema.payrollLines.resultId, result.id))
          .orderBy(asc(schema.payrollLines.displayOrder));

        const document = {
          employment_id: result.employmentId,
          currency: result.currency,
          gross: result.gross,
          total_deduction: result.totalDeduction,
          net_pay: result.netPay,
          lines: lines.map((line) => ({
            code: line.payItemCode,
            name: line.payItemName,
            category: line.category,
            amount: line.amount,
          })),
        };

        const body = Buffer.from(JSON.stringify(document, null, 2), 'utf8');
        const contentHash = createHash('sha256').update(body).digest();
        const objectKey = buildObjectKey(uow.tenantId, 'PAYSLIP', 'json', this.clock.now());

        await this.storage.put({ key: objectKey, body, contentType: 'application/json' });

        const storageObjectId = uuidv7();
        await uow.tx.insert(schema.storageObjects).values({
          id: storageObjectId,
          tenantId: uow.tenantId,
          companyId: run.companyId,
          category: 'PAYSLIP',
          objectKey,
          contentType: 'application/json',
          sizeBytes: body.length,
          sha256: contentHash,
          status: 'AVAILABLE',
        });

        // เลข version เดินหน้าเรื่อย ๆ — ออกใหม่ไม่ทับของเดิม (spec §14)
        const existing = await uow.tx
          .select({ version: schema.payslipDocuments.documentVersion })
          .from(schema.payslipDocuments)
          .where(eq(schema.payslipDocuments.resultId, result.id));
        const nextVersion =
          existing.reduce((highest, row) => Math.max(highest, row.version), 0) + 1;

        await uow.tx.insert(schema.payslipDocuments).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          companyId: run.companyId,
          runId,
          resultId: result.id,
          employmentId: result.employmentId,
          documentVersion: nextVersion,
          storageObjectId,
          gross: result.gross,
          totalDeduction: result.totalDeduction,
          netPay: result.netPay,
          currency: result.currency,
          contentHash,
          publishedBy: this.requestContext.requirePrincipal().principalId,
        });

        published += 1;
      }

      await uow.audit({
        action: 'payslip.publish',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        metadata: { published },
      });

      return { published };
    });
  }

  /** สลิปของตัวเอง — พนักงานเห็นเฉพาะของตัวเอง (spec §5 payslip.read.self) */
  async listMyPayslips(): Promise<{ items: Record<string, unknown>[] }> {
    const employmentId = this.requestContext.requirePrincipal().employmentId;
    if (employmentId === null) {
      throw AppError.validation('this account is not linked to an employment record');
    }

    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.payslipDocuments)
        .where(eq(schema.payslipDocuments.employmentId, employmentId));

      return {
        items: rows.map((row) => ({
          id: row.id,
          run_id: row.runId,
          document_version: row.documentVersion,
          gross: row.gross,
          total_deduction: row.totalDeduction,
          net_pay: row.netPay,
          currency: row.currency,
          published_at: row.publishedAt.toISOString(),
        })),
      };
    });
  }

  /**
   * URL ดาวน์โหลดสลิป
   *
   * พนักงานเปิดได้เฉพาะของตัวเอง เว้นแต่มี `payslip.read.all`
   * และทุกครั้งถูกบันทึกทั้งใน access log และ audit (spec §17)
   */
  async createPayslipDownloadUrl(payslipId: string): Promise<{ url: string; expires_at: string }> {
    const principal = this.requestContext.requirePrincipal();

    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.payslipDocuments)
        .where(eq(schema.payslipDocuments.id, payslipId))
        .limit(1);
      const payslip = rows[0];
      if (payslip === undefined) throw AppError.notFound('payslip');

      const canReadAll = principal.permissions.has('workforce.payslip.read.all');
      if (!canReadAll && payslip.employmentId !== principal.employmentId) {
        // ตอบ 404 ไม่ใช่ 403 — ไม่ยืนยันว่าสลิปของคนอื่นมีอยู่
        throw AppError.notFound('payslip');
      }

      if (payslip.storageObjectId === null) throw AppError.notFound('payslip document');
      const objects = await uow.tx
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, payslip.storageObjectId))
        .limit(1);
      const object = objects[0];
      if (object === undefined) throw AppError.notFound('payslip document');

      const ttl = this.config.STORAGE_SIGNED_URL_TTL_SECONDS;
      const url = await this.storage.createSignedDownloadUrl(object.objectKey, {
        expiresInSeconds: ttl,
      });

      await uow.tx.insert(schema.payslipAccessLog).values({
        id: uuidv7(),
        tenantId: uow.tenantId,
        payslipId,
        principalId: principal.principalId,
        ip: this.requestContext.get()?.ip ?? null,
        purpose: 'DOWNLOAD',
      });

      await uow.audit({
        action: 'payslip.download',
        resourceType: 'payslip_document',
        resourceId: payslipId,
        outcome: 'SUCCESS',
        companyId: payslip.companyId,
        metadata: { own_payslip: payslip.employmentId === principal.employmentId },
      });

      return {
        url,
        expires_at: new Date(this.clock.now().getTime() + ttl * 1000).toISOString(),
      };
    });
  }

  async createBankProfile(input: {
    company_id: string;
    code: string;
    name: string;
    bank_code: string;
    account_number: string | null;
    file_format: 'CSV' | 'TXT' | 'ISO20022';
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const id = uuidv7();
      await uow.tx.insert(schema.bankProfiles).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code,
        name: input.name,
        bankCode: input.bank_code,
        accountNumberEncrypted:
          input.account_number === null ? null : this.encryption.encrypt(input.account_number),
        fileFormat: input.file_format,
      });

      await uow.audit({
        action: 'bank.profile.create',
        resourceType: 'bank_profile',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { code: input.code, bank_code: input.bank_code },
      });

      return { id, code: input.code };
    });
  }

  /**
   * สร้าง bank batch จาก run ที่ล็อกแล้ว
   *
   * control_total ต้องเท่ากับผลรวมของ items เสมอ (spec §19.5) — คำนวณจาก items
   * ที่เพิ่งสร้าง ไม่ใช่จากตัวเลขที่ส่งเข้ามา
   */
  async createBankBatch(input: {
    run_id: string;
    bank_profile_id: string;
    value_date: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const runs = await uow.tx
        .select()
        .from(schema.payrollRuns)
        .where(eq(schema.payrollRuns.id, input.run_id))
        .limit(1);
      const run = runs[0];
      if (run === undefined) throw AppError.notFound('payroll run');
      if (!isLocked(run.status as PayrollRunStatus)) {
        throw AppError.conflict('a bank batch can only be created from a locked payroll run');
      }

      const results = await uow.tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(eq(schema.payrollEmployeeResults.runId, input.run_id))
        .orderBy(asc(schema.payrollEmployeeResults.employmentId));

      const batchId = uuidv7();
      const items: (typeof schema.bankBatchItems.$inferInsert)[] = [];
      let total = Money.zero();

      for (const result of results) {
        const amount = Money.of(result.netPay, result.currency);
        // ยอดศูนย์หรือติดลบไม่ควรถูกส่งเข้าธนาคาร
        if (!amount.isPositive()) continue;

        items.push({
          id: uuidv7(),
          tenantId: uow.tenantId,
          batchId,
          employmentId: result.employmentId,
          resultId: result.id,
          amount: amount.toString(),
          reference: `PAY-${result.employmentId.slice(0, 8)}`,
        });
        total = total.add(amount);
      }

      await uow.tx.insert(schema.bankBatches).values({
        id: batchId,
        tenantId: uow.tenantId,
        companyId: run.companyId,
        runId: input.run_id,
        bankProfileId: input.bank_profile_id,
        valueDate: input.value_date,
        controlCount: items.length,
        controlTotal: total.toString(),
        status: 'GENERATED',
        generatedAt: this.clock.now(),
      });

      if (items.length > 0) await uow.tx.insert(schema.bankBatchItems).values(items);

      await uow.audit({
        action: 'bank.batch.create',
        resourceType: 'bank_batch',
        resourceId: batchId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        metadata: { control_count: items.length, control_total: total.toString() },
      });

      return {
        id: batchId,
        control_count: items.length,
        control_total: total.toString(),
        status: 'GENERATED',
      };
    });
  }

  /** ตรวจว่ายอดควบคุมยังตรงกับ items — ใช้ก่อนส่งไฟล์เข้าธนาคาร */
  async verifyBankBatch(batchId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const batches = await uow.tx
        .select()
        .from(schema.bankBatches)
        .where(eq(schema.bankBatches.id, batchId))
        .limit(1);
      const batch = batches[0];
      if (batch === undefined) throw AppError.notFound('bank batch');

      const items = await uow.tx
        .select()
        .from(schema.bankBatchItems)
        .where(eq(schema.bankBatchItems.batchId, batchId));

      const sum = Money.sum(items.map((item) => Money.of(item.amount, batch.currency)), batch.currency);
      const matches =
        items.length === batch.controlCount && sum.equals(Money.of(batch.controlTotal, batch.currency));

      return {
        id: batchId,
        matches,
        control_count: batch.controlCount,
        actual_count: items.length,
        control_total: batch.controlTotal,
        actual_total: sum.toString(),
      };
    });
  }

  /**
   * Payroll register — รายงานยอดต่อพนักงานของ run
   * ผลรวมท้ายรายงานต้องเท่ากับผลรวมของแถว
   */
  async exportPayrollRegister(runId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const runs = await uow.tx
        .select()
        .from(schema.payrollRuns)
        .where(eq(schema.payrollRuns.id, runId))
        .limit(1);
      const run = runs[0];
      if (run === undefined) throw AppError.notFound('payroll run');

      const results = await uow.tx
        .select({
          result: schema.payrollEmployeeResults,
          employeeCode: schema.employments.employeeCode,
        })
        .from(schema.payrollEmployeeResults)
        .innerJoin(
          schema.employments,
          eq(schema.employments.id, schema.payrollEmployeeResults.employmentId),
        )
        .where(eq(schema.payrollEmployeeResults.runId, runId))
        .orderBy(asc(schema.employments.employeeCode));

      const rows: RegisterRow[] = results.map((entry) => ({
        employee_code: entry.employeeCode,
        employment_id: entry.result.employmentId,
        gross: entry.result.gross,
        total_deduction: entry.result.totalDeduction,
        employer_contribution: entry.result.employerContribution,
        net_pay: entry.result.netPay,
      }));

      const totals = {
        gross: Money.sum(rows.map((row) => Money.of(row.gross))).toString(),
        total_deduction: Money.sum(rows.map((row) => Money.of(row.total_deduction))).toString(),
        employer_contribution: Money.sum(
          rows.map((row) => Money.of(row.employer_contribution)),
        ).toString(),
        net_pay: Money.sum(rows.map((row) => Money.of(row.net_pay))).toString(),
      };

      const csv = toCsv(
        ['employee_code', 'gross', 'total_deduction', 'employer_contribution', 'net_pay'],
        rows.map((row) => [
          row.employee_code,
          row.gross,
          row.total_deduction,
          row.employer_contribution,
          row.net_pay,
        ]),
      );

      const body = Buffer.from(csv, 'utf8');
      const objectKey = buildObjectKey(uow.tenantId, 'EXPORT', 'csv', this.clock.now());
      await this.storage.put({ key: objectKey, body, contentType: 'text/csv' });

      const storageObjectId = uuidv7();
      await uow.tx.insert(schema.storageObjects).values({
        id: storageObjectId,
        tenantId: uow.tenantId,
        companyId: run.companyId,
        category: 'EXPORT',
        objectKey,
        contentType: 'text/csv',
        sizeBytes: body.length,
        sha256: createHash('sha256').update(body).digest(),
        status: 'AVAILABLE',
      });

      const jobId = uuidv7();
      await uow.tx.insert(schema.exportJobs).values({
        id: jobId,
        tenantId: uow.tenantId,
        companyId: run.companyId,
        exportType: 'PAYROLL_REGISTER',
        runId,
        status: 'SUCCEEDED',
        rowCount: rows.length,
        storageObjectId,
        contentHash: createHash('sha256').update(body).digest(),
        requestedBy: this.requestContext.requirePrincipal().principalId,
        startedAt: this.clock.now(),
        finishedAt: this.clock.now(),
      });

      await uow.audit({
        action: 'payroll.export',
        resourceType: 'export_job',
        resourceId: jobId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        metadata: { export_type: 'PAYROLL_REGISTER', rows: rows.length },
      });

      return { export_job_id: jobId, row_count: rows.length, totals };
    });
  }

  /** ทำเครื่องหมายว่าจ่ายแล้ว — ขยับ run ไป PAID (spec §10) */
  async markPaid(runId: string, batchId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const batches = await uow.tx
        .select()
        .from(schema.bankBatches)
        .where(eq(schema.bankBatches.id, batchId))
        .limit(1);
      const batch = batches[0];
      if (batch === undefined) throw AppError.notFound('bank batch');
      if (batch.runId !== runId) {
        throw AppError.validation('the bank batch does not belong to this payroll run');
      }

      const items = await uow.tx
        .select()
        .from(schema.bankBatchItems)
        .where(eq(schema.bankBatchItems.batchId, batchId));
      const actualTotal = Money.sum(
        items.map((item) => Money.of(item.amount, batch.currency)),
        batch.currency,
      );
      const verification = {
        matches:
          items.length === batch.controlCount &&
          actualTotal.equals(Money.of(batch.controlTotal, batch.currency)),
        control_count: batch.controlCount,
        actual_count: items.length,
        control_total: batch.controlTotal,
        actual_total: actualTotal.toString(),
      };

      if (!verification.matches) {
        // spec §19.5: bank control total ต้องเท่ากับ items ก่อนจ่าย
        throw AppError.conflict('the bank batch control totals do not match its items', {
          meta: verification,
        });
      }

      const now = this.clock.now();
      await uow.tx
        .update(schema.bankBatchItems)
        .set({ status: 'PAID' })
        .where(eq(schema.bankBatchItems.batchId, batchId));
      await uow.tx
        .update(schema.bankBatches)
        .set({ status: 'SETTLED', settledAt: now })
        .where(eq(schema.bankBatches.id, batchId));
      await uow.tx
        .update(schema.payrollRuns)
        .set({ status: 'PAID' })
        .where(eq(schema.payrollRuns.id, runId));

      await uow.audit({
        action: 'payroll.run.mark-paid',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        metadata: { bank_batch_id: batchId },
      });

      return { run_id: runId, status: 'PAID', bank_batch_id: batchId };
    });
  }

}

/** CSV ที่ escape ถูกต้อง — ค่าที่มีคอมมาหรืออัญประกาศต้องไม่ทำให้คอลัมน์เพี้ยน */
function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  return [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n');
}
