import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { requireUuid } from '../organization/organization.controller';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { zodPipe } from '../shared/zod-validation.pipe';
import { DocumentsService } from './documents.service';

const createBankProfileSchema = z.object({
  company_id: z.string().uuid(),
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  bank_code: z.string().trim().min(1).max(20),
  /** เก็บเข้ารหัส ไม่เคยส่งกลับออก API (spec §16) */
  account_number: z.string().trim().min(1).max(40).nullable().default(null),
  file_format: z.enum(['CSV', 'TXT', 'ISO20022']).default('CSV'),
});

const createBankBatchSchema = z.object({
  run_id: z.string().uuid(),
  bank_profile_id: z.string().uuid(),
  value_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const markPaidSchema = z.object({
  bank_batch_id: z.string().uuid(),
});

@Controller()
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  /** ออกสลิป — ทำได้เฉพาะจาก run ที่ล็อกแล้ว (spec §19.5) */
  @Post('payroll-runs/:runId/payslips:publish')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.approve')
  @Idempotent()
  async publishPayslips(@Param('runId') runId: string): Promise<{ published: number }> {
    return this.service.publishPayslips(requireUuid(runId, 'runId'));
  }

  @Get('me/payslips')
  @RequirePermissions('workforce.payslip.read.self')
  async myPayslips(): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listMyPayslips();
  }

  @Get('payslips/:payslipId/download-url')
  @RequirePermissions('workforce.payslip.read.self')
  async downloadPayslip(
    @Param('payslipId') payslipId: string,
  ): Promise<{ url: string; expires_at: string }> {
    return this.service.createPayslipDownloadUrl(requireUuid(payslipId, 'payslipId'));
  }

  @Post('bank-profiles')
  @HttpCode(201)
  @RequirePermissions('workforce.payroll.export')
  @Idempotent()
  async createBankProfile(
    @Body(zodPipe(createBankProfileSchema)) body: z.infer<typeof createBankProfileSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createBankProfile(body);
  }

  @Post('bank-batches')
  @HttpCode(201)
  @RequirePermissions('workforce.payroll.export')
  @Idempotent()
  async createBankBatch(
    @Body(zodPipe(createBankBatchSchema)) body: z.infer<typeof createBankBatchSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createBankBatch(body);
  }

  /** ตรวจยอดควบคุมก่อนส่งไฟล์เข้าธนาคาร (spec §19.5) */
  @Get('bank-batches/:batchId/verify')
  @RequirePermissions('workforce.payroll.export')
  async verifyBankBatch(@Param('batchId') batchId: string): Promise<Record<string, unknown>> {
    return this.service.verifyBankBatch(requireUuid(batchId, 'batchId'));
  }

  @Post('payroll-runs/:runId/export-jobs')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.export')
  @Idempotent()
  async exportRegister(@Param('runId') runId: string): Promise<Record<string, unknown>> {
    return this.service.exportPayrollRegister(requireUuid(runId, 'runId'));
  }

  @Post('payroll-runs/:runId/mark-paid')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.mark-paid')
  @Idempotent()
  async markPaid(
    @Param('runId') runId: string,
    @Body(zodPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.markPaid(requireUuid(runId, 'runId'), body.bank_batch_id);
  }
}
