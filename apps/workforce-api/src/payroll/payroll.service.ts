import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { AppError, LocalDate, Money, Rate, uuidv7, type Clock } from '@workforce/domain';
import {
  assertMutable,
  assertPublishable,
  assertTransition,
  buildVariables,
  calculatePayroll,
  collectReferences,
  resolveRuleSet,
  ruleParameters,
  RuleSetError,
  topologicalOrder,
  validateForSubmission,
  type FormulaNode,
  type FormulaValue,
  type PayItemDefinition,
  type PayrollRunStatus,
  type RuleType,
  type StatutoryRuleSet,
} from '@workforce/payroll-engine';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { UnitOfWork, type UnitOfWorkContext } from '../infrastructure/unit-of-work';
import { RequestContextService } from '../shared/request-context';
import { CLOCK } from '../shared/tokens';

/** ชุดกฎที่ payroll run ต้องมีครบก่อนส่งอนุมัติ */
const REQUIRED_RULE_TYPES: readonly RuleType[] = [
  'TH_SOCIAL_SECURITY',
  'OT_MULTIPLIER',
  'TH_PIT_WITHHOLDING',
];

@Injectable()
export class PayrollService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly requestContext: RequestContextService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- pay items ---

  async createPayItem(input: {
    company_id: string;
    code: string;
    name: string;
    category: string;
    calculation_type: string;
    formula: FormulaNode | null;
    affects_net_pay: boolean;
    taxable: boolean;
    social_security_base: boolean;
    provident_fund_base: boolean;
    employer_only: boolean;
    rounding_decimals: number;
    rounding_mode: string;
    display_order: number;
    effective_from: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const id = uuidv7();
      await uow.tx.insert(schema.payItemDefinitions).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        code: input.code.toUpperCase(),
        name: input.name,
        category: input.category,
        calculationType: input.calculation_type,
        affectsNetPay: input.affects_net_pay,
        taxable: input.taxable,
        socialSecurityBase: input.social_security_base,
        providentFundBase: input.provident_fund_base,
        employerOnly: input.employer_only,
        roundingDecimals: input.rounding_decimals,
        roundingMode: input.rounding_mode,
        displayOrder: input.display_order,
        status: 'DRAFT',
        effectiveFrom: input.effective_from,
      });

      if (input.formula !== null) {
        const references = collectReferences(input.formula);
        await uow.tx.insert(schema.payItemFormulas).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          payItemId: id,
          formulaVersion: 1,
          ast: input.formula as unknown as Record<string, unknown>,
          referencedVariables: references.variables,
          referencedItems: references.items,
          status: 'DRAFT',
        });
      }

      await uow.audit({
        action: 'payroll.pay-item.create',
        resourceType: 'pay_item_definition',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { code: input.code, category: input.category, calculation_type: input.calculation_type },
      });

      return { id, code: input.code.toUpperCase(), status: 'DRAFT' };
    });
  }

  /**
   * Publish pay item — ตรวจ dependency graph ทั้งชุดก่อน
   * circular dependency ต้องล้มที่นี่ ไม่ใช่ตอนคำนวณเงินจริง (spec §9.4)
   */
  async publishPayItem(payItemId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const item = await this.loadPayItem(uow.tx, payItemId);

      const siblings = await this.loadPayItemDefinitions(uow.tx, item.companyId, item.effectiveFrom);
      topologicalOrder(siblings.map((entry) => ({ code: entry.code, formula: entry.formula })));

      await uow.tx
        .update(schema.payItemDefinitions)
        .set({ status: 'PUBLISHED' })
        .where(eq(schema.payItemDefinitions.id, payItemId));
      await uow.tx
        .update(schema.payItemFormulas)
        .set({ status: 'PUBLISHED', publishedAt: this.clock.now() })
        .where(eq(schema.payItemFormulas.payItemId, payItemId));

      await uow.audit({
        action: 'payroll.pay-item.publish',
        resourceType: 'pay_item_definition',
        resourceId: payItemId,
        outcome: 'SUCCESS',
        companyId: item.companyId,
        after: { status: 'PUBLISHED' },
      });

      return { id: payItemId, status: 'PUBLISHED' };
    });
  }

  // --- statutory rule sets ---

  async createRuleSet(input: {
    rule_type: string;
    version: string;
    effective_from: string;
    effective_to: string | null;
    parameters: Record<string, string>;
    source_reference: string;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const id = uuidv7();
      await uow.tx.insert(schema.statutoryRuleSets).values({
        id,
        tenantId: uow.tenantId,
        ruleType: input.rule_type,
        version: input.version,
        status: 'DRAFT',
        effectiveFrom: input.effective_from,
        effectiveTo: input.effective_to,
        parameters: input.parameters,
        sourceReference: input.source_reference,
      });

      await uow.audit({
        action: 'payroll.rule-set.create',
        resourceType: 'statutory_rule_set',
        resourceId: id,
        outcome: 'SUCCESS',
        after: { rule_type: input.rule_type, version: input.version, status: 'DRAFT' },
      });

      return { id, status: 'DRAFT' };
    });
  }

  /**
   * Publish ชุดกฎ
   *
   * ต้องมี source, ผู้รับรอง และ golden test ผ่านครบ (spec §9.5) — ทั้ง engine
   * และ CHECK constraint ใน DB บังคับข้อนี้ซ้ำกันคนละชั้น
   */
  async publishRuleSet(
    ruleSetId: string,
    input: { approved_by: string; golden_tests_passed: boolean },
  ): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.statutoryRuleSets)
        .where(eq(schema.statutoryRuleSets.id, ruleSetId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) throw AppError.notFound('statutory rule set');

      const now = this.clock.now();
      const candidate: StatutoryRuleSet = {
        id: row.id,
        jurisdiction: row.jurisdiction,
        ruleType: row.ruleType as RuleType,
        version: row.version,
        status: 'PUBLISHED',
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        parameters: row.parameters as Record<string, string>,
        formulas: {},
        sourceReference: row.sourceReference,
        approvedBy: input.approved_by,
        approvedAt: now.toISOString(),
        goldenTestsPassed: input.golden_tests_passed,
      };

      // ปฏิเสธก่อนแตะ DB เพื่อให้ข้อความบอกครบทุกข้อที่ยังขาด
      //
      // แปลงเป็น AppError: การขาดลายเซ็นรับรองเป็นเงื่อนไขทางธุรกิจที่คาดไว้แล้ว
      // ไม่ใช่ความผิดพลาดของระบบ ถ้าปล่อย RuleSetError ดิบขึ้นไปจะกลายเป็น 500
      // ซึ่งบอกผู้เรียกไม่ได้ว่าต้องเติมอะไรบ้าง และกลบสัญญาณ error rate ของจริง
      try {
        assertPublishable(candidate);
      } catch (error) {
        if (error instanceof RuleSetError) {
          throw AppError.conflict(error.message, { meta: { rule_type: row.ruleType } });
        }
        throw error;
      }

      await uow.tx
        .update(schema.statutoryRuleSets)
        .set({
          status: 'PUBLISHED',
          approvedBy: input.approved_by,
          approvedAt: now,
          goldenTestsPassed: input.golden_tests_passed,
        })
        .where(eq(schema.statutoryRuleSets.id, ruleSetId));

      await uow.audit({
        action: 'payroll.rule-set.publish',
        resourceType: 'statutory_rule_set',
        resourceId: ruleSetId,
        outcome: 'SUCCESS',
        reason: `approved by ${input.approved_by}`,
        before: { status: row.status },
        after: { status: 'PUBLISHED', approved_by: input.approved_by },
      });

      return { id: ruleSetId, status: 'PUBLISHED' };
    });
  }

  // --- periods and runs ---

  async createPeriod(input: {
    company_id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    pay_date: string;
    period_sequence: number;
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const id = uuidv7();
      await uow.tx.insert(schema.payrollPeriods).values({
        id,
        tenantId: uow.tenantId,
        companyId: input.company_id,
        name: input.name,
        startsOn: input.starts_on,
        endsOn: input.ends_on,
        payDate: input.pay_date,
        periodYear: LocalDate.parse(input.ends_on).year,
        periodSequence: input.period_sequence,
      });

      await uow.audit({
        action: 'payroll.period.create',
        resourceType: 'payroll_period',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: input.company_id,
        after: { name: input.name, pay_date: input.pay_date },
      });

      return { id };
    });
  }

  async createRun(input: {
    period_id: string;
    timesheet_period_id: string;
    run_type: 'REGULAR' | 'OFF_CYCLE' | 'ADJUSTMENT' | 'FINAL_PAY';
  }): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const periods = await uow.tx
        .select()
        .from(schema.payrollPeriods)
        .where(eq(schema.payrollPeriods.id, input.period_id))
        .limit(1);
      const period = periods[0];
      if (period === undefined) throw AppError.notFound('payroll period');

      const id = uuidv7();
      await uow.tx.insert(schema.payrollRuns).values({
        id,
        tenantId: uow.tenantId,
        companyId: period.companyId,
        periodId: input.period_id,
        runType: input.run_type,
        status: 'DRAFT',
        timesheetPeriodId: input.timesheet_period_id,
        waivedValidations: [],
        preparedBy: this.requestContext.requirePrincipal().principalId,
      });

      await uow.audit({
        action: 'payroll.run.create',
        resourceType: 'payroll_run',
        resourceId: id,
        outcome: 'SUCCESS',
        companyId: period.companyId,
        after: { run_type: input.run_type, period_id: input.period_id },
      });

      return { id, status: 'DRAFT' };
    });
  }

  /**
   * สร้าง input snapshot จาก timesheet ที่ปิดแล้ว
   *
   * นี่คือจุดที่ payroll หยุดอ่านข้อมูลสด — ทุกอย่างหลังจากนี้คำนวณจาก snapshot
   * เท่านั้น (spec §3.3 P1, §10.1)
   */
  async buildSnapshot(runId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const run = await this.loadRun(uow.tx, runId);
      assertMutable(run.status as PayrollRunStatus, 'building an input snapshot');

      if (run.timesheetPeriodId === null) {
        throw AppError.validation('the run is not linked to a timesheet period');
      }

      const timesheetPeriods = await uow.tx
        .select()
        .from(schema.timesheetPeriods)
        .where(eq(schema.timesheetPeriods.id, run.timesheetPeriodId))
        .limit(1);
      const timesheetPeriod = timesheetPeriods[0];
      if (timesheetPeriod === undefined) throw AppError.notFound('timesheet period');
      if (timesheetPeriod.status !== 'CLOSED') {
        // spec §10.2: ต้องมี closed timesheet snapshot ก่อน
        throw AppError.conflict('the timesheet period must be closed before building a snapshot');
      }

      const periods = await uow.tx
        .select()
        .from(schema.payrollPeriods)
        .where(eq(schema.payrollPeriods.id, run.periodId))
        .limit(1);
      const period = periods[0];
      if (period === undefined) throw AppError.notFound('payroll period');

      const timesheets = await uow.tx
        .select()
        .from(schema.timesheets)
        .where(eq(schema.timesheets.periodId, run.timesheetPeriodId));

      const ruleSets = await this.loadRuleSets(uow.tx);
      const rules = ruleParameters(ruleSets, period.endsOn, REQUIRED_RULE_TYPES);

      const snapshotId = uuidv7();
      const rows: (typeof schema.payrollSnapshotEmployments.$inferInsert)[] = [];

      for (const timesheet of timesheets) {
        const employments = await uow.tx
          .select()
          .from(schema.employments)
          .where(eq(schema.employments.id, timesheet.employmentId))
          .limit(1);
        const employment = employments[0];
        if (employment === undefined) continue;

        const compensation = await this.resolveCompensation(
          uow.tx,
          timesheet.employmentId,
          period.endsOn,
        );
        if (compensation === undefined) continue;

        const { money: moneyParameters, rates: rateParameters } = splitParameters(rules.parameters);

        const monthly = Money.of(compensation.amount, compensation.currency);
        // ฐานหาร 30/8 มาจากพารามิเตอร์ ไม่ได้ตรึงในโค้ดเหมือนระบบเดิม (spec §3.3 P8)
        const standardDays = Rate.of(rules.parameters['standard_days_per_month'] ?? '30');
        const standardHours = Rate.of(rules.parameters['standard_hours_per_day'] ?? '8');
        const daily = monthly.divide(standardDays, 'HALF_EVEN');
        const hourly = daily.divide(standardHours, 'HALF_EVEN');

        rows.push({
          id: uuidv7(),
          tenantId: uow.tenantId,
          snapshotId,
          employmentId: timesheet.employmentId,
          employeeCode: employment.employeeCode,
          employmentType: employment.employmentType,
          hiredOn: employment.hiredOn,
          terminatedOn: employment.terminatedOn,
          currency: compensation.currency,
          // พารามิเตอร์ของ rule set มีทั้งจำนวนเงิน (เพดาน/ลดหย่อน) และอัตรา
          // (ตัวคูณ/เปอร์เซ็นต์) — ต้องแยกกัน เพราะ Money × Money เป็น error
          // โดยเจตนาใน formula engine (ADR-0007)
          moneyVariables: {
            monthly_salary: monthly.toString(),
            daily_rate: daily.toString(),
            hourly_rate: hourly.toString(),
            ...moneyParameters,
          },
          quantityVariables: {
            ...rateParameters,
            worked_minutes: timesheet.workedMinutes,
            paid_minutes: timesheet.paidMinutes,
            late_minutes: timesheet.lateMinutes,
            absence_minutes: timesheet.absenceMinutes,
            early_out_minutes: timesheet.earlyOutMinutes,
            paid_leave_minutes: timesheet.paidLeaveMinutes,
            unpaid_leave_minutes: timesheet.unpaidLeaveMinutes,
            unpaid_leave_days: Math.round((timesheet.unpaidLeaveMinutes / 480) * 10_000) / 10_000,
            ot_workday_minutes: timesheet.otWorkdayMinutes,
            ot_rest_day_minutes: timesheet.otRestDayMinutes,
            ot_holiday_minutes: timesheet.otHolidayMinutes,
            scheduled_days: timesheet.scheduledDays,
            worked_days: timesheet.workedDays,
            // งวดเต็ม = 1; งวดที่เข้า/ออกกลางงวดจะน้อยกว่า 1
            period_proration: 1,
            remaining_periods: 1,
          },
          manualAmounts: {},
          timesheetId: timesheet.id,
        });
      }

      // แถวแม่ต้องมาก่อนเสมอ — payroll_snapshot_employments อ้าง snapshot_id ด้วย FK
      await uow.tx.insert(schema.payrollInputSnapshots).values({
        id: snapshotId,
        tenantId: uow.tenantId,
        runId,
        builtBy: this.requestContext.requirePrincipal().principalId,
        contentHash: hashSnapshot(rows),
        employmentCount: rows.length,
        ruleSetIds: ruleSets.filter((entry) => entry.status === 'PUBLISHED').map((entry) => entry.id),
        payItemIds: [],
      });

      if (rows.length > 0) await uow.tx.insert(schema.payrollSnapshotEmployments).values(rows);

      await uow.tx
        .update(schema.payrollRuns)
        .set({ snapshotId })
        .where(eq(schema.payrollRuns.id, runId));

      await uow.audit({
        action: 'payroll.run.snapshot',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        metadata: { employments: rows.length, missing_rule_sets: rules.missing },
      });

      return {
        snapshot_id: snapshotId,
        employment_count: rows.length,
        missing_rule_sets: rules.missing,
      };
    });
  }

  /** คำนวณจาก snapshot — ไม่แตะข้อมูลสดเลย */
  async calculate(runId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const run = await this.loadRun(uow.tx, runId);
      assertMutable(run.status as PayrollRunStatus, 'calculating');
      assertTransition(run.status as PayrollRunStatus, 'CALCULATING');

      if (run.snapshotId === null) {
        throw AppError.validation('build the input snapshot before calculating');
      }

      const periods = await uow.tx
        .select()
        .from(schema.payrollPeriods)
        .where(eq(schema.payrollPeriods.id, run.periodId))
        .limit(1);
      const period = periods[0];
      if (period === undefined) throw AppError.notFound('payroll period');

      const definitions = await this.loadPayItemDefinitions(uow.tx, run.companyId, period.endsOn);
      const published = definitions.filter((entry) => entry.status === 'PUBLISHED');

      const snapshotRows = await uow.tx
        .select()
        .from(schema.payrollSnapshotEmployments)
        .where(eq(schema.payrollSnapshotEmployments.snapshotId, run.snapshotId));

      // ล้างผลเดิมก่อนคำนวณใหม่ — lock guard จะปฏิเสธถ้า run ถูกล็อกแล้ว
      await uow.tx
        .delete(schema.payrollEmployeeResults)
        .where(eq(schema.payrollEmployeeResults.runId, runId));

      let negativeNet = 0;
      let errors = 0;

      for (const row of snapshotRows) {
        const money = row.moneyVariables as Record<string, string>;
        const quantities = row.quantityVariables as Record<string, number>;

        const variables: Record<string, FormulaValue> = buildVariables({
          currency: row.currency,
          money,
          quantities,
        });

        const result = calculatePayroll(
          {
            employmentId: row.employmentId,
            currency: row.currency,
            variables,
            manualAmounts: row.manualAmounts as Record<string, string>,
          },
          published.map(toEngineDefinition),
        );

        if (result.net.isNegative()) negativeNet += 1;
        if (result.warnings.some((warning) => warning.code === 'FORMULA_ERROR')) errors += 1;

        const resultId = uuidv7();
        await uow.tx.insert(schema.payrollEmployeeResults).values({
          id: resultId,
          tenantId: uow.tenantId,
          runId,
          employmentId: row.employmentId,
          currency: row.currency,
          gross: result.gross.toString(),
          totalDeduction: result.totalDeduction.toString(),
          employerContribution: result.employerContribution.toString(),
          netPay: result.net.toString(),
          taxableBase: result.taxableBase.toString(),
          socialSecurityBase: result.socialSecurityBase.toString(),
          providentFundBase: result.providentFundBase.toString(),
          warnings: result.warnings,
          calculatedAt: this.clock.now(),
        });

        for (const line of result.lines) {
          const lineId = uuidv7();
          await uow.tx.insert(schema.payrollLines).values({
            id: lineId,
            tenantId: uow.tenantId,
            resultId,
            payItemCode: line.code,
            payItemName: line.name,
            category: line.category,
            amount: line.amount.toString(),
            taxable: line.taxable,
            affectsNetPay: line.affectsNetPay,
            employerOnly: line.employerOnly,
            displayOrder: line.displayOrder,
          });

          // trace ทุกบรรทัด — ตอบได้ว่าตัวเลขมาจากไหน (spec §9.4)
          await uow.tx.insert(schema.payrollLineCalculationTraces).values({
            id: uuidv7(),
            tenantId: uow.tenantId,
            lineId,
            calculationType: line.trace.calculation_type,
            preRound: line.trace.pre_round,
            rounding: line.trace.rounding,
            steps: line.trace.steps,
          });
        }
      }

      await uow.tx
        .update(schema.payrollRuns)
        .set({ status: 'CALCULATED' })
        .where(eq(schema.payrollRuns.id, runId));

      await uow.audit({
        action: 'payroll.run.calculate',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        metadata: { employments: snapshotRows.length, negative_net: negativeNet, errors },
      });

      return {
        run_id: runId,
        status: 'CALCULATED',
        employments: snapshotRows.length,
        negative_net_count: negativeNet,
        calculation_error_count: errors,
      };
    });
  }

  async submit(runId: string, waivedValidations: readonly string[]): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const run = await this.loadRun(uow.tx, runId);
      assertTransition(run.status as PayrollRunStatus, 'REVIEW');

      const problems = await this.validateRun(uow, run, waivedValidations);
      if (problems.length > 0) {
        throw AppError.conflict('the payroll run has unresolved blocking validations', {
          meta: { problems },
        });
      }

      await uow.tx
        .update(schema.payrollRuns)
        .set({
          status: 'REVIEW',
          submittedBy: this.requestContext.requirePrincipal().principalId,
          submittedAt: this.clock.now(),
          waivedValidations: [...waivedValidations],
        })
        .where(eq(schema.payrollRuns.id, runId));

      await uow.audit({
        action: 'payroll.run.submit',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        after: { status: 'REVIEW', waived: waivedValidations },
      });

      return { id: runId, status: 'REVIEW' };
    });
  }

  /** อนุมัติ — ผู้อนุมัติต้องไม่ใช่ผู้เตรียม (spec §10.2 maker-checker) */
  async approve(runId: string, reason: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const run = await this.loadRun(uow.tx, runId);
      assertTransition(run.status as PayrollRunStatus, 'APPROVED');

      const approverId = this.requestContext.requirePrincipal().principalId;
      if (run.preparedBy === approverId || run.submittedBy === approverId) {
        throw AppError.forbidden('the approver must be different from the preparer');
      }

      await uow.tx
        .update(schema.payrollRuns)
        .set({ status: 'APPROVED', approvedBy: approverId, approvedAt: this.clock.now() })
        .where(eq(schema.payrollRuns.id, runId));

      await uow.audit({
        action: 'payroll.run.approve',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        reason,
        before: { status: run.status },
        after: { status: 'APPROVED' },
      });

      return { id: runId, status: 'APPROVED' };
    });
  }

  async reject(runId: string, reason: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const run = await this.loadRun(uow.tx, runId);
      assertTransition(run.status as PayrollRunStatus, 'DRAFT');

      await uow.tx
        .update(schema.payrollRuns)
        .set({ status: 'DRAFT', rejectionReason: reason })
        .where(eq(schema.payrollRuns.id, runId));

      await uow.audit({
        action: 'payroll.run.reject',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        reason,
        after: { status: 'DRAFT' },
      });

      return { id: runId, status: 'DRAFT' };
    });
  }

  /**
   * ล็อก — หลังจากนี้ผลลัพธ์แก้ไม่ได้ทั้งจาก API และจาก DB
   * บันทึก checksum ของยอดรวมไว้พิสูจน์ว่าไม่มีอะไรเปลี่ยนหลังอนุมัติ
   */
  async lock(runId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const run = await this.loadRun(uow.tx, runId);
      assertTransition(run.status as PayrollRunStatus, 'LOCKED');

      const results = await uow.tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(eq(schema.payrollEmployeeResults.runId, runId))
        .orderBy(asc(schema.payrollEmployeeResults.employmentId));

      const checksum = createHash('sha256')
        .update(
          JSON.stringify(
            results.map((row) => [row.employmentId, row.gross, row.totalDeduction, row.netPay]),
          ),
        )
        .digest();

      const now = this.clock.now();
      await uow.tx
        .update(schema.payrollRuns)
        .set({
          status: 'LOCKED',
          lockedBy: this.requestContext.requirePrincipal().principalId,
          lockedAt: now,
          lockChecksum: checksum,
        })
        .where(eq(schema.payrollRuns.id, runId));

      // บันทึก YTD หลังล็อกเท่านั้น — ก่อนหน้านั้นตัวเลขยังเปลี่ยนได้
      const periods = await uow.tx
        .select()
        .from(schema.payrollPeriods)
        .where(eq(schema.payrollPeriods.id, run.periodId))
        .limit(1);
      const periodYear = periods[0]?.periodYear ?? LocalDate.fromInstant(now, 'UTC').year;

      for (const row of results) {
        const taxLine = await uow.tx
          .select({ amount: schema.payrollLines.amount })
          .from(schema.payrollLines)
          .where(
            and(
              eq(schema.payrollLines.resultId, row.id),
              eq(schema.payrollLines.payItemCode, 'WITHHOLDING_TAX'),
            ),
          )
          .limit(1);

        await uow.tx.insert(schema.payrollYtdLedger).values({
          id: uuidv7(),
          tenantId: uow.tenantId,
          employmentId: row.employmentId,
          periodYear,
          runId,
          entryType: 'PAYROLL',
          gross: row.gross,
          taxable: row.taxableBase,
          taxWithheld: taxLine[0]?.amount ?? '0',
          socialSecurity: row.socialSecurityBase,
          providentFund: row.providentFundBase,
          netPay: row.netPay,
          reason: 'payroll run locked',
        });
      }

      await uow.audit({
        action: 'payroll.run.lock',
        resourceType: 'payroll_run',
        resourceId: runId,
        outcome: 'SUCCESS',
        companyId: run.companyId,
        after: { status: 'LOCKED', checksum: checksum.toString('hex').slice(0, 16) },
      });

      await uow.publish({
        aggregateType: 'payroll_run',
        aggregateId: runId,
        eventType: 'payroll.run.locked',
        payload: { run_id: runId, employments: results.length },
      });

      return { id: runId, status: 'LOCKED', employments: results.length };
    });
  }

  /**
   * รายการงวดเงินเดือน พร้อมข้อมูลงวดที่ผูกอยู่
   *
   * join กับ payroll_periods เพราะหน้าจอรายการต้องแสดงชื่องวดและวันจ่าย
   * ถ้าให้ client ยิงทีละงวดจะกลายเป็น N+1 request
   */
  async listRuns(filter: { company_id?: string; status?: string }): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const conditions = [
        filter.company_id === undefined
          ? undefined
          : eq(schema.payrollRuns.companyId, filter.company_id),
        filter.status === undefined ? undefined : eq(schema.payrollRuns.status, filter.status),
      ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);

      const rows = await uow.tx
        .select({ run: schema.payrollRuns, period: schema.payrollPeriods })
        .from(schema.payrollRuns)
        .innerJoin(schema.payrollPeriods, eq(schema.payrollRuns.periodId, schema.payrollPeriods.id))
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(desc(schema.payrollRuns.id));

      return { items: rows.map((row) => this.runSummary(row.run, row.period)) };
    });
  }

  /** spec §12 GET /payroll-runs/{id} */
  async getRun(runId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select({ run: schema.payrollRuns, period: schema.payrollPeriods })
        .from(schema.payrollRuns)
        .innerJoin(schema.payrollPeriods, eq(schema.payrollRuns.periodId, schema.payrollPeriods.id))
        .where(eq(schema.payrollRuns.id, runId))
        .limit(1);

      const row = rows[0];
      if (row === undefined) throw AppError.notFound('payroll run');
      return this.runSummary(row.run, row.period);
    });
  }

  async listPeriods(companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.payrollPeriods)
        .where(companyId === undefined ? undefined : eq(schema.payrollPeriods.companyId, companyId))
        .orderBy(desc(schema.payrollPeriods.periodYear), desc(schema.payrollPeriods.periodSequence));

      return {
        items: rows.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          name: row.name,
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          pay_date: row.payDate,
          period_year: row.periodYear,
          period_sequence: row.periodSequence,
          status: row.status,
        })),
      };
    });
  }

  async listRuleSets(): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.statutoryRuleSets)
        .orderBy(asc(schema.statutoryRuleSets.ruleType), desc(schema.statutoryRuleSets.effectiveFrom));

      return {
        items: rows.map((row) => ({
          id: row.id,
          jurisdiction: row.jurisdiction,
          rule_type: row.ruleType,
          version: row.version,
          status: row.status,
          effective_from: row.effectiveFrom,
          effective_to: row.effectiveTo,
          parameters: row.parameters,
          source_reference: row.sourceReference,
          approved_by: row.approvedBy,
          approved_at: row.approvedAt?.toISOString() ?? null,
          golden_tests_passed: row.goldenTestsPassed,
        })),
      };
    });
  }

  async listPayItems(companyId?: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const rows = await uow.tx
        .select()
        .from(schema.payItemDefinitions)
        .where(companyId === undefined ? undefined : eq(schema.payItemDefinitions.companyId, companyId))
        .orderBy(asc(schema.payItemDefinitions.displayOrder), asc(schema.payItemDefinitions.code));

      return {
        items: rows.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          code: row.code,
          name: row.name,
          category: row.category,
          calculation_type: row.calculationType,
          status: row.status,
          taxable: row.taxable,
          social_security_base: row.socialSecurityBase,
          employer_only: row.employerOnly,
          display_order: row.displayOrder,
          effective_from: row.effectiveFrom,
        })),
      };
    });
  }

  private runSummary(
    run: typeof schema.payrollRuns.$inferSelect,
    period: typeof schema.payrollPeriods.$inferSelect,
  ): Record<string, unknown> {
    return {
      id: run.id,
      company_id: run.companyId,
      period_id: run.periodId,
      period_name: period.name,
      starts_on: period.startsOn,
      ends_on: period.endsOn,
      pay_date: period.payDate,
      run_type: run.runType,
      status: run.status,
      timesheet_period_id: run.timesheetPeriodId,
      submitted_at: run.submittedAt?.toISOString() ?? null,
      approved_at: run.approvedAt?.toISOString() ?? null,
      locked_at: run.lockedAt?.toISOString() ?? null,
      rejection_reason: run.rejectionReason,
    };
  }

  async listResults(runId: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const results = await uow.tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(eq(schema.payrollEmployeeResults.runId, runId))
        .orderBy(asc(schema.payrollEmployeeResults.employmentId));

      const items: Record<string, unknown>[] = [];
      for (const row of results) {
        const lines = await uow.tx
          .select()
          .from(schema.payrollLines)
          .where(eq(schema.payrollLines.resultId, row.id))
          .orderBy(asc(schema.payrollLines.displayOrder));

        items.push({
          id: row.id,
          employment_id: row.employmentId,
          currency: row.currency,
          gross: row.gross,
          total_deduction: row.totalDeduction,
          employer_contribution: row.employerContribution,
          net_pay: row.netPay,
          warnings: row.warnings,
          lines: lines.map((line) => ({
            code: line.payItemCode,
            name: line.payItemName,
            category: line.category,
            amount: line.amount,
            employer_only: line.employerOnly,
          })),
        });
      }

      return { items };
    });
  }

  async getTrace(runId: string, employmentId: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.uow.run(async (uow) => {
      const results = await uow.tx
        .select()
        .from(schema.payrollEmployeeResults)
        .where(
          and(
            eq(schema.payrollEmployeeResults.runId, runId),
            eq(schema.payrollEmployeeResults.employmentId, employmentId),
          ),
        )
        .limit(1);
      const result = results[0];
      if (result === undefined) throw AppError.notFound('payroll result');

      const rows = await uow.tx
        .select({
          code: schema.payrollLines.payItemCode,
          amount: schema.payrollLines.amount,
          calculationType: schema.payrollLineCalculationTraces.calculationType,
          preRound: schema.payrollLineCalculationTraces.preRound,
          rounding: schema.payrollLineCalculationTraces.rounding,
          steps: schema.payrollLineCalculationTraces.steps,
        })
        .from(schema.payrollLines)
        .innerJoin(
          schema.payrollLineCalculationTraces,
          eq(schema.payrollLineCalculationTraces.lineId, schema.payrollLines.id),
        )
        .where(eq(schema.payrollLines.resultId, result.id))
        .orderBy(asc(schema.payrollLines.displayOrder));

      return {
        items: rows.map((row) => ({
          pay_item_code: row.code,
          result: row.amount,
          calculation_type: row.calculationType,
          pre_round: row.preRound,
          rounding: row.rounding,
          steps: row.steps,
        })),
      };
    });
  }

  // --- helpers ---

  private async validateRun(
    uow: UnitOfWorkContext,
    run: typeof schema.payrollRuns.$inferSelect,
    waived: readonly string[],
  ): Promise<ReturnType<typeof validateForSubmission>> {
    const results = await uow.tx
      .select()
      .from(schema.payrollEmployeeResults)
      .where(eq(schema.payrollEmployeeResults.runId, run.id));

    const negativeNet = results.filter((row) => Money.of(row.netPay).isNegative()).length;
    const errors = results.filter((row) =>
      (row.warnings as { code: string }[]).some((warning) => warning.code === 'FORMULA_ERROR'),
    ).length;

    const timesheetClosed =
      run.timesheetPeriodId !== null &&
      (
        await uow.tx
          .select({ status: schema.timesheetPeriods.status })
          .from(schema.timesheetPeriods)
          .where(eq(schema.timesheetPeriods.id, run.timesheetPeriodId))
          .limit(1)
      )[0]?.status === 'CLOSED';

    const periods = await uow.tx
      .select()
      .from(schema.payrollPeriods)
      .where(eq(schema.payrollPeriods.id, run.periodId))
      .limit(1);
    const ruleSets = await this.loadRuleSets(uow.tx);
    const rules = ruleParameters(ruleSets, periods[0]?.endsOn ?? '2000-01-01', REQUIRED_RULE_TYPES);

    const blockingExceptions = await uow.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.attendanceExceptions)
      .where(
        and(
          eq(schema.attendanceExceptions.companyId, run.companyId),
          eq(schema.attendanceExceptions.status, 'OPEN'),
          eq(schema.attendanceExceptions.blocking, true),
        ),
      );

    // snapshot hash ต้องยังตรงกับเนื้อหา — ถ้าไม่ตรงแปลว่ามีอะไรถูกแก้หลังสร้าง
    let snapshotMatches = false;
    if (run.snapshotId !== null) {
      const snapshots = await uow.tx
        .select()
        .from(schema.payrollInputSnapshots)
        .where(eq(schema.payrollInputSnapshots.id, run.snapshotId))
        .limit(1);
      const rows = await uow.tx
        .select()
        .from(schema.payrollSnapshotEmployments)
        .where(eq(schema.payrollSnapshotEmployments.snapshotId, run.snapshotId));
      const stored = snapshots[0];
      snapshotMatches =
        stored !== undefined &&
        Buffer.from(stored.contentHash).equals(hashSnapshot(rows));
    }

    return validateForSubmission({
      hasClosedTimesheetSnapshot: timesheetClosed,
      employeeCount: results.length,
      negativeNetCount: negativeNet,
      calculationErrorCount: errors,
      unresolvedBlockingExceptions: Number(blockingExceptions[0]?.count ?? 0),
      missingRuleSets: rules.missing,
      snapshotHashMatches: snapshotMatches,
      waivedCodes: waived,
    });
  }

  private async loadRun(tx: Tx, runId: string): Promise<typeof schema.payrollRuns.$inferSelect> {
    const rows = await tx
      .select()
      .from(schema.payrollRuns)
      .where(eq(schema.payrollRuns.id, runId))
      .limit(1)
      .for('update');
    const row = rows[0];
    if (row === undefined) throw AppError.notFound('payroll run');
    return row;
  }

  private async loadPayItem(
    tx: Tx,
    payItemId: string,
  ): Promise<typeof schema.payItemDefinitions.$inferSelect> {
    const rows = await tx
      .select()
      .from(schema.payItemDefinitions)
      .where(eq(schema.payItemDefinitions.id, payItemId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw AppError.notFound('pay item');
    return row;
  }

  private async loadRuleSets(tx: Tx): Promise<StatutoryRuleSet[]> {
    const rows = await tx.select().from(schema.statutoryRuleSets);
    return rows.map((row) => ({
      id: row.id,
      jurisdiction: row.jurisdiction,
      ruleType: row.ruleType as RuleType,
      version: row.version,
      status: row.status as StatutoryRuleSet['status'],
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      parameters: row.parameters as Record<string, string>,
      formulas: {},
      sourceReference: row.sourceReference,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      goldenTestsPassed: row.goldenTestsPassed,
    }));
  }

  private async loadPayItemDefinitions(
    tx: Tx,
    companyId: string,
    asOf: string,
  ): Promise<
    (typeof schema.payItemDefinitions.$inferSelect & { formula: FormulaNode | null })[]
  > {
    const rows = await tx
      .select()
      .from(schema.payItemDefinitions)
      .where(
        and(
          eq(schema.payItemDefinitions.companyId, companyId),
          sql`${schema.payItemDefinitions.effectiveFrom} <= ${asOf}`,
          or(
            isNull(schema.payItemDefinitions.effectiveTo),
            sql`${schema.payItemDefinitions.effectiveTo} >= ${asOf}`,
          ),
        ),
      )
      .orderBy(asc(schema.payItemDefinitions.displayOrder));

    const withFormulas: (typeof schema.payItemDefinitions.$inferSelect & {
      formula: FormulaNode | null;
    })[] = [];

    for (const row of rows) {
      const formulas = await tx
        .select()
        .from(schema.payItemFormulas)
        .where(eq(schema.payItemFormulas.payItemId, row.id))
        .orderBy(desc(schema.payItemFormulas.formulaVersion))
        .limit(1);
      withFormulas.push({
        ...row,
        formula: (formulas[0]?.ast as FormulaNode | undefined) ?? null,
      });
    }

    return withFormulas;
  }

  private async resolveCompensation(
    tx: Tx,
    employmentId: string,
    asOf: string,
  ): Promise<typeof schema.compensationRates.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.compensationRates)
      .where(
        and(
          eq(schema.compensationRates.employmentId, employmentId),
          sql`${schema.compensationRates.effectiveFrom} <= ${asOf}`,
          or(
            isNull(schema.compensationRates.effectiveTo),
            sql`${schema.compensationRates.effectiveTo} >= ${asOf}`,
          ),
        ),
      )
      .orderBy(desc(schema.compensationRates.effectiveFrom))
      .limit(1);
    return rows[0];
  }
}

function toEngineDefinition(
  row: typeof schema.payItemDefinitions.$inferSelect & { formula: FormulaNode | null },
): PayItemDefinition {
  return {
    code: row.code,
    name: row.name,
    category: row.category as PayItemDefinition['category'],
    calculationType: row.calculationType as PayItemDefinition['calculationType'],
    formula: row.formula,
    affectsNetPay: row.affectsNetPay,
    taxable: row.taxable,
    socialSecurityBase: row.socialSecurityBase,
    providentFundBase: row.providentFundBase,
    employerOnly: row.employerOnly,
    roundingDecimals: row.roundingDecimals,
    roundingMode: row.roundingMode as PayItemDefinition['roundingMode'],
    displayOrder: row.displayOrder,
  };
}

/** hash เนื้อหา snapshot แบบ deterministic เพื่อตรวจว่าไม่มีอะไรเปลี่ยนหลังสร้าง */
function hashSnapshot(
  rows: readonly {
    employmentId: string;
    // insert type ปล่อยให้ optional ได้เพราะมี default ที่ DB; select type ไม่ optional
    // hash ต้องรับได้ทั้งสองฝั่งเพื่อให้ค่าที่คำนวณตอนสร้างกับตอนตรวจตรงกัน
    moneyVariables?: unknown;
    quantityVariables?: unknown;
    manualAmounts?: unknown;
  }[],
): Buffer {
  const canonical = [...rows]
    .map((row) => ({
      employment: row.employmentId,
      money: sortKeys(row.moneyVariables ?? {}),
      quantities: sortKeys(row.quantityVariables ?? {}),
      manual: sortKeys(row.manualAmounts ?? {}),
    }))
    .sort((left, right) => (left.employment < right.employment ? -1 : 1));
  return createHash('sha256').update(JSON.stringify(canonical)).digest();
}

/**
 * แยกพารามิเตอร์ของ rule set เป็นจำนวนเงินกับอัตรา
 *
 * ใช้ชื่อเป็นตัวตัดสินและประกาศไว้ชัดเจน เพื่อให้คนที่เพิ่มพารามิเตอร์ใหม่รู้ว่า
 * ต้องตั้งชื่อยังไง — ตั้งผิดจะได้ FORMULA_ERROR ที่ระบุชื่อ ไม่ใช่ตัวเลขเพี้ยนเงียบ ๆ
 */
function splitParameters(parameters: Readonly<Record<string, string>>): {
  money: Record<string, string>;
  rates: Record<string, number>;
} {
  const money: Record<string, string> = {};
  const rates: Record<string, number> = {};

  for (const [name, value] of Object.entries(parameters)) {
    if (RATE_PARAMETER_PATTERN.test(name)) rates[name] = Number(value);
    else money[name] = value;
  }

  return { money, rates };
}

/** อัตรา/ตัวคูณ/จำนวนหน่วยมาตรฐาน — ที่เหลือถือเป็นจำนวนเงิน */
const RATE_PARAMETER_PATTERN = /(_rate|_multiplier|_percent|_ratio)$|^standard_/;

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}
