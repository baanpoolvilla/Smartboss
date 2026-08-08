import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  approvePayrollRunSchema,
  createPayItemSchema,
  createPayrollPeriodSchema,
  createPayrollRunSchema,
  createRuleSetSchema,
  publishRuleSetSchema,
  rejectPayrollRunSchema,
  submitPayrollRunSchema,
  type CreatePayItemInput,
  type CreatePayrollRunInput,
  type CreateRuleSetInput,
} from '@workforce/contracts';
import type { FormulaNode } from '@workforce/payroll-engine';
import type { z } from 'zod';
import { requireUuid } from '../organization/organization.controller';
import { Idempotent, RequirePermissions } from '../shared/decorators';
import { zodPipe } from '../shared/zod-validation.pipe';
import { PayrollService } from './payroll.service';

@Controller()
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  // --- catalog ---

  @Post('pay-items')
  @HttpCode(201)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async createPayItem(
    @Body(zodPipe(createPayItemSchema)) body: CreatePayItemInput,
  ): Promise<Record<string, unknown>> {
    return this.service.createPayItem({
      ...body,
      formula: body.formula as FormulaNode | null,
    });
  }

  @Post('pay-items/:payItemId/publish')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async publishPayItem(@Param('payItemId') payItemId: string): Promise<Record<string, unknown>> {
    return this.service.publishPayItem(requireUuid(payItemId, 'payItemId'));
  }

  @Post('statutory-rule-sets')
  @HttpCode(201)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async createRuleSet(
    @Body(zodPipe(createRuleSetSchema)) body: CreateRuleSetInput,
  ): Promise<Record<string, unknown>> {
    return this.service.createRuleSet(body);
  }

  /**
   * Publish ชุดกฎ — ต้องผ่าน step-up MFA เพราะกระทบเงินของทุกคน
   * และต้องมีลายเซ็นผู้รับรอง + golden test (spec §9.5)
   */
  @Post('statutory-rule-sets/:ruleSetId/publish')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.approve')
  @Idempotent()
  async publishRuleSet(
    @Param('ruleSetId') ruleSetId: string,
    @Body(zodPipe(publishRuleSetSchema)) body: z.infer<typeof publishRuleSetSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.publishRuleSet(requireUuid(ruleSetId, 'ruleSetId'), body);
  }

  // --- runs ---

  @Post('payroll-periods')
  @HttpCode(201)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async createPeriod(
    @Body(zodPipe(createPayrollPeriodSchema)) body: z.infer<typeof createPayrollPeriodSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.createPeriod(body);
  }

  @Post('payroll-runs')
  @HttpCode(201)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async createRun(
    @Body(zodPipe(createPayrollRunSchema)) body: CreatePayrollRunInput,
  ): Promise<Record<string, unknown>> {
    return this.service.createRun(body);
  }

  /** ตรึงข้อมูลนำเข้า — หลังจากนี้ payroll ไม่อ่านข้อมูลสดอีก (spec §10.1) */
  @Post('payroll-runs/:runId/snapshot')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async snapshot(@Param('runId') runId: string): Promise<Record<string, unknown>> {
    return this.service.buildSnapshot(requireUuid(runId, 'runId'));
  }

  @Post('payroll-runs/:runId/calculate')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.calculate')
  @Idempotent()
  async calculate(@Param('runId') runId: string): Promise<Record<string, unknown>> {
    return this.service.calculate(requireUuid(runId, 'runId'));
  }

  @Post('payroll-runs/:runId/submit')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.prepare')
  @Idempotent()
  async submit(
    @Param('runId') runId: string,
    @Body(zodPipe(submitPayrollRunSchema)) body: z.infer<typeof submitPayrollRunSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.submit(requireUuid(runId, 'runId'), body.waived_validations);
  }

  @Post('payroll-runs/:runId/approve')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.approve')
  @Idempotent()
  async approve(
    @Param('runId') runId: string,
    @Body(zodPipe(approvePayrollRunSchema)) body: z.infer<typeof approvePayrollRunSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.approve(requireUuid(runId, 'runId'), body.reason);
  }

  @Post('payroll-runs/:runId/reject')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.approve')
  @Idempotent()
  async reject(
    @Param('runId') runId: string,
    @Body(zodPipe(rejectPayrollRunSchema)) body: z.infer<typeof rejectPayrollRunSchema>,
  ): Promise<Record<string, unknown>> {
    return this.service.reject(requireUuid(runId, 'runId'), body.reason);
  }

  /** ล็อก — ผลลัพธ์แก้ไม่ได้อีกทั้งจาก API และจาก DB (spec §10) */
  @Post('payroll-runs/:runId/lock')
  @HttpCode(200)
  @RequirePermissions('workforce.payroll.lock')
  @Idempotent()
  async lock(@Param('runId') runId: string): Promise<Record<string, unknown>> {
    return this.service.lock(requireUuid(runId, 'runId'));
  }

  @Get('payroll-runs')
  @RequirePermissions('workforce.payroll.read')
  async listRuns(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listRuns({
      ...(companyId === undefined ? {} : { company_id: requireUuid(companyId, 'company_id') }),
      ...(status === undefined ? {} : { status }),
    });
  }

  @Get('payroll-runs/:runId')
  @RequirePermissions('workforce.payroll.read')
  async getRun(@Param('runId') runId: string): Promise<Record<string, unknown>> {
    return this.service.getRun(requireUuid(runId, 'runId'));
  }

  @Get('payroll-periods')
  @RequirePermissions('workforce.payroll.read')
  async listPeriods(@Query('company_id') companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listPeriods(
      companyId === undefined ? undefined : requireUuid(companyId, 'company_id'),
    );
  }

  @Get('statutory-rule-sets')
  @RequirePermissions('workforce.payroll.read')
  async listRuleSets(): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listRuleSets();
  }

  @Get('pay-items')
  @RequirePermissions('workforce.payroll.read')
  async listPayItems(@Query('company_id') companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listPayItems(
      companyId === undefined ? undefined : requireUuid(companyId, 'company_id'),
    );
  }

  @Get('payroll-runs/:runId/employees')
  @RequirePermissions('workforce.payroll.read')
  async listResults(@Param('runId') runId: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.listResults(requireUuid(runId, 'runId'));
  }

  /** ที่มาของทุกตัวเลขในบรรทัดเดียว (spec §9.4, §10.3) */
  @Get('payroll-runs/:runId/employees/:employmentId/trace')
  @RequirePermissions('workforce.payroll.read')
  async trace(
    @Param('runId') runId: string,
    @Param('employmentId') employmentId: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.service.getTrace(
      requireUuid(runId, 'runId'),
      requireUuid(employmentId, 'employmentId'),
    );
  }
}
