import { Money, Rate } from '@workforce/domain';
import { describe, expect, it } from 'vitest';
import {
  buildVariables,
  calculatePayroll,
  resultDigest,
  type EmploymentSnapshot,
  type PayItemDefinition,
} from './calculate';
import { collectReferences, evaluateFormula, FormulaError, topologicalOrder, type FormulaNode } from './formula';
import { REFERENCE_RULE_DRAFTS } from './reference-catalog';
import { assertPublishable, resolveRuleSet, ruleParameters, RuleSetError, type StatutoryRuleSet } from './rule-sets';
import { assertMutable, assertTransition, canTransition, isLocked, validateForSubmission } from './state-machine';

const CURRENCY = 'THB';

function context(
  money: Record<string, string> = {},
  quantities: Record<string, number> = {},
  items: Record<string, Money> = {},
): { variables: Record<string, ReturnType<typeof buildVariables>[string]>; items: Record<string, Money>; currency: string } {
  return {
    variables: buildVariables({ currency: CURRENCY, money, quantities }),
    items,
    currency: CURRENCY,
  };
}

function evaluate(node: FormulaNode, ctx = context()): string {
  return evaluateFormula(node, ctx).value.value.toString();
}

describe('formula DSL', () => {
  it('evaluates literals without any eval', () => {
    expect(evaluate({ kind: 'money', value: '1875.00' })).toBe('1875.0000');
    expect(evaluate({ kind: 'rate', value: '1.5' })).toBe('1.500000');
  });

  it('computes the overtime example from the spec', () => {
    // spec §9.4: approved_ot_hours * hourly_rate * ot_multiplier = 1875.00
    const node: FormulaNode = {
      kind: 'multiply',
      money: {
        kind: 'multiply',
        money: { kind: 'var', name: 'hourly_rate' },
        rate: { kind: 'var', name: 'ot_hours' },
      },
      rate: { kind: 'rate', value: '1.5' },
    };
    const result = evaluateFormula(node, context({ hourly_rate: '125.0000' }, { ot_hours: 10 }));
    expect((result.value.value as Money).round(2, 'HALF_UP').toFixed(2)).toBe('1875.00');
  });

  it('refuses to multiply money by money', () => {
    expect(() =>
      evaluate({
        kind: 'multiply',
        money: { kind: 'money', value: '100' },
        rate: { kind: 'money', value: '2' },
      }),
    ).toThrow(FormulaError);
  });

  it('refuses an unknown variable rather than defaulting to zero', () => {
    expect(() => evaluate({ kind: 'var', name: 'does_not_exist' })).toThrow(/unknown variable/);
  });

  it('applies a ceiling, as the social security cap requires', () => {
    const node: FormulaNode = {
      kind: 'cap',
      value: { kind: 'money', value: '1200' },
      ceiling: { kind: 'money', value: '750' },
    };
    expect(evaluate(node)).toBe('750.0000');
  });

  it('applies a floor so tax never goes negative', () => {
    const node: FormulaNode = {
      kind: 'floor_at',
      value: { kind: 'money', value: '-500' },
      minimum: { kind: 'money', value: '0' },
    };
    expect(evaluate(node)).toBe('0.0000');
  });

  it('converts minutes to hours', () => {
    expect(evaluate({ kind: 'minutes_to_hours', minutes: { kind: 'rate', value: '90' } })).toBe('1.500030');
  });

  it('walks a progressive bracket', () => {
    // 400,000 ผ่านขั้น 150k@0% + 150k@5% + 100k จาก 200k@10%
    const node: FormulaNode = {
      kind: 'bracket',
      value: { kind: 'money', value: '400000' },
      brackets: [
        { size: '150000', rate: '0' },
        { size: '150000', rate: '0.05' },
        { size: '200000', rate: '0.10' },
        { size: null, rate: '0.15' },
      ],
    };
    expect(evaluate(node)).toBe('17500.0000');
  });

  it('stops the bracket walk when nothing is left', () => {
    const node: FormulaNode = {
      kind: 'bracket',
      value: { kind: 'money', value: '100000' },
      brackets: [
        { size: '150000', rate: '0' },
        { size: null, rate: '0.35' },
      ],
    };
    expect(evaluate(node)).toBe('0.0000');
  });

  it('picks branches without evaluating both sides into the result', () => {
    const node: FormulaNode = {
      kind: 'if_positive',
      test: { kind: 'var', name: 'bonus_eligible' },
      then: { kind: 'money', value: '1000' },
      otherwise: { kind: 'money', value: '0' },
    };
    expect(evaluate(node, context({}, { bonus_eligible: 1 }))).toBe('1000.0000');
    expect(evaluate(node, context({}, { bonus_eligible: 0 }))).toBe('0.0000');
  });

  it('records a trace for every step', () => {
    const node: FormulaNode = {
      kind: 'round',
      value: {
        kind: 'multiply',
        money: { kind: 'var', name: 'base' },
        rate: { kind: 'rate', value: '0.05' },
      },
      decimals: 2,
      mode: 'HALF_UP',
    };
    const result = evaluateFormula(node, context({ base: '15000' }));
    const nodes = result.trace.map((step) => step.node);
    expect(nodes).toEqual(['var', 'multiply', 'round']);
    expect(result.trace[2]?.detail).toMatchObject({ rounding: 'HALF_UP', decimals: 2 });
  });

  it('collects the references a formula depends on', () => {
    const node: FormulaNode = {
      kind: 'add',
      left: { kind: 'item', code: 'SALARY' },
      right: { kind: 'multiply', money: { kind: 'item', code: 'BONUS' }, rate: { kind: 'var', name: 'rate' } },
    };
    expect(collectReferences(node)).toEqual({ variables: ['rate'], items: ['SALARY', 'BONUS'] });
  });
});

describe('dependency ordering', () => {
  it('orders items so dependencies are calculated first', () => {
    const order = topologicalOrder([
      { code: 'TAX', formula: { kind: 'item', code: 'GROSS' } },
      { code: 'GROSS', formula: { kind: 'item', code: 'SALARY' } },
      { code: 'SALARY', formula: null },
    ]);
    expect(order.indexOf('SALARY')).toBeLessThan(order.indexOf('GROSS'));
    expect(order.indexOf('GROSS')).toBeLessThan(order.indexOf('TAX'));
  });

  it('detects a circular dependency at publish time', () => {
    expect(() =>
      topologicalOrder([
        { code: 'A', formula: { kind: 'item', code: 'B' } },
        { code: 'B', formula: { kind: 'item', code: 'A' } },
      ]),
    ).toThrow(/circular/);
  });

  it('rejects a reference to an item that does not exist', () => {
    expect(() => topologicalOrder([{ code: 'A', formula: { kind: 'item', code: 'GHOST' } }])).toThrow(
      /referenced but not defined/,
    );
  });
});

describe('payroll calculation', () => {
  const items: PayItemDefinition[] = [
    {
      code: 'SALARY',
      name: 'เงินเดือน',
      category: 'EARNING',
      calculationType: 'FORMULA',
      formula: { kind: 'var', name: 'monthly_salary' },
      affectsNetPay: true,
      taxable: true,
      socialSecurityBase: true,
      providentFundBase: true,
      employerOnly: false,
      roundingDecimals: 2,
      roundingMode: 'HALF_UP',
      displayOrder: 10,
    },
    {
      code: 'SSO_EMPLOYEE',
      name: 'ประกันสังคม',
      category: 'DEDUCTION',
      calculationType: 'PERCENTAGE',
      formula: {
        kind: 'cap',
        value: {
          kind: 'multiply',
          money: { kind: 'cap', value: { kind: 'item', code: 'SALARY' }, ceiling: { kind: 'var', name: 'sso_wage_ceiling' } },
          rate: { kind: 'var', name: 'sso_employee_rate' },
        },
        ceiling: { kind: 'var', name: 'sso_contribution_ceiling' },
      },
      affectsNetPay: true,
      taxable: false,
      socialSecurityBase: false,
      providentFundBase: false,
      employerOnly: false,
      roundingDecimals: 2,
      roundingMode: 'HALF_UP',
      displayOrder: 50,
    },
    {
      code: 'SSO_EMPLOYER',
      name: 'ประกันสังคมนายจ้าง',
      category: 'EMPLOYER_CONTRIBUTION',
      calculationType: 'PERCENTAGE',
      formula: { kind: 'item', code: 'SSO_EMPLOYEE' },
      affectsNetPay: false,
      taxable: false,
      socialSecurityBase: false,
      providentFundBase: false,
      employerOnly: true,
      roundingDecimals: 2,
      roundingMode: 'HALF_UP',
      displayOrder: 51,
    },
    {
      code: 'OTHER_DEDUCTION',
      name: 'หักอื่น',
      category: 'DEDUCTION',
      calculationType: 'MANUAL',
      formula: null,
      affectsNetPay: true,
      taxable: false,
      socialSecurityBase: false,
      providentFundBase: false,
      employerOnly: false,
      roundingDecimals: 2,
      roundingMode: 'HALF_UP',
      displayOrder: 70,
    },
  ];

  function snapshot(overrides: Partial<EmploymentSnapshot> = {}): EmploymentSnapshot {
    return {
      employmentId: 'emp-1',
      currency: CURRENCY,
      variables: buildVariables({
        currency: CURRENCY,
        money: { monthly_salary: '30000.00', sso_wage_ceiling: '15000.00', sso_contribution_ceiling: '750.00' },
        quantities: {},
      }),
      manualAmounts: { OTHER_DEDUCTION: '0.00' },
      ...overrides,
    };
  }

  function withRate(base: EmploymentSnapshot, rate: string): EmploymentSnapshot {
    return {
      ...base,
      variables: { ...base.variables, sso_employee_rate: { type: 'rate', value: Rate.of(rate) } },
    };
  }

  it('calculates gross, deductions and net from the pay item graph', () => {
    const result = calculatePayroll(withRate(snapshot(), '0.05'), items);

    expect(result.gross.toFixed(2)).toBe('30000.00');
    // เพดานค่าจ้าง 15,000 × 5% = 750 ซึ่งเท่ากับเพดานเงินสมทบพอดี
    expect(result.totalDeduction.toFixed(2)).toBe('750.00');
    expect(result.net.toFixed(2)).toBe('29250.00');
    expect(result.employerContribution.toFixed(2)).toBe('750.00');
    expect(result.warnings).toEqual([]);
  });

  it('keeps the totals equal to the sum of the rounded lines', () => {
    // spec §19.5: payslip totals ต้องเท่ากับผลรวมของบรรทัด
    const result = calculatePayroll(withRate(snapshot(), '0.05'), items);

    const earnings = result.lines.filter((line) => line.category === 'EARNING' && line.affectsNetPay);
    const deductions = result.lines.filter((line) => line.category === 'DEDUCTION' && line.affectsNetPay);

    expect(Money.sum(earnings.map((line) => line.amount)).equals(result.gross)).toBe(true);
    expect(Money.sum(deductions.map((line) => line.amount)).equals(result.totalDeduction)).toBe(true);
    expect(result.gross.subtract(result.totalDeduction).equals(result.net)).toBe(true);
  });

  it('excludes employer contributions from net pay', () => {
    const result = calculatePayroll(withRate(snapshot(), '0.05'), items);
    const employerLine = result.lines.find((line) => line.code === 'SSO_EMPLOYER');
    expect(employerLine?.employerOnly).toBe(true);
    // นายจ้างจ่ายเอง ไม่หักจากลูกจ้าง
    expect(result.net.toFixed(2)).toBe('29250.00');
  });

  it('records a full calculation trace per line', () => {
    // spec §9.4: อธิบายผลคำนวณได้ทุกบรรทัด
    const result = calculatePayroll(withRate(snapshot(), '0.05'), items);
    const sso = result.lines.find((line) => line.code === 'SSO_EMPLOYEE');

    expect(sso?.trace.calculation_type).toBe('PERCENTAGE');
    expect(sso?.trace.rounding).toBe('HALF_UP_2');
    expect(sso?.trace.pre_round).toBe('750.0000');
    expect(sso?.trace.steps.map((step) => step.node)).toContain('cap');
  });

  it('warns instead of silently zeroing a missing manual amount', () => {
    const result = calculatePayroll(
      withRate({ ...snapshot(), manualAmounts: {} }, '0.05'),
      items,
    );
    expect(result.warnings.map((warning) => warning.code)).toContain('MISSING_MANUAL_AMOUNT');
  });

  it('flags negative net pay rather than paying a negative amount', () => {
    // spec §10.2: negative net ต้องถูกแก้ก่อนอนุมัติ
    const base = withRate(snapshot(), '0.05');
    const result = calculatePayroll(
      { ...base, manualAmounts: { OTHER_DEDUCTION: '40000.00' } },
      items,
    );

    expect(result.net.isNegative()).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain('NEGATIVE_NET_PAY');
  });

  it('reports a formula error without aborting the whole payroll', () => {
    const broken: PayItemDefinition[] = [
      { ...(items[0] as PayItemDefinition), formula: { kind: 'var', name: 'missing_variable' } },
    ];
    const result = calculatePayroll(snapshot(), broken);

    expect(result.warnings[0]?.code).toBe('FORMULA_ERROR');
    expect(result.lines[0]?.amount.toFixed(2)).toBe('0.00');
  });

  it('produces an identical result when run twice', () => {
    // spec §17: payroll reproducibility 100%
    const input = withRate(snapshot(), '0.05');
    expect(resultDigest(calculatePayroll(input, items))).toBe(
      resultDigest(calculatePayroll(input, items)),
    );
  });

  it('does not depend on the order pay items are declared in', () => {
    const input = withRate(snapshot(), '0.05');
    const forward = calculatePayroll(input, items);
    const reversed = calculatePayroll(input, [...items].reverse());
    expect(resultDigest(reversed)).toBe(resultDigest(forward));
  });
});

describe('statutory rule sets', () => {
  const approved: StatutoryRuleSet = {
    id: 'sso-2026',
    jurisdiction: 'TH',
    ruleType: 'TH_SOCIAL_SECURITY',
    version: '2026.1',
    status: 'PUBLISHED',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    parameters: { sso_employee_rate: '0.05' },
    formulas: {},
    sourceReference: 'https://www.sso.go.th/...',
    approvedBy: 'payroll-sme',
    approvedAt: '2026-01-05T00:00:00Z',
    goldenTestsPassed: true,
  };

  it('refuses to publish a rule set that nobody has approved', () => {
    // spec §9.5: ต้องมี source, ผู้รับรอง และ golden test ก่อน
    for (const draft of REFERENCE_RULE_DRAFTS) {
      expect(() => assertPublishable(draft)).toThrow(RuleSetError);
    }
  });

  it('lists every missing prerequisite at once', () => {
    try {
      assertPublishable(REFERENCE_RULE_DRAFTS[0] as StatutoryRuleSet);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('sourceReference');
      expect(message).toContain('approvedBy');
      expect(message).toContain('golden test');
    }
  });

  it('accepts a fully approved rule set', () => {
    expect(() => assertPublishable(approved)).not.toThrow();
  });

  it('resolves only published rule sets', () => {
    const drafts = [...REFERENCE_RULE_DRAFTS];
    expect(resolveRuleSet(drafts, 'TH_SOCIAL_SECURITY', '2026-08-01')).toBeUndefined();
    expect(resolveRuleSet([approved], 'TH_SOCIAL_SECURITY', '2026-08-01')?.version).toBe('2026.1');
  });

  it('resolves by effective date, not by most recently created', () => {
    const older: StatutoryRuleSet = { ...approved, id: 'old', version: '2025.1', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' };
    expect(resolveRuleSet([approved, older], 'TH_SOCIAL_SECURITY', '2025-06-01')?.version).toBe('2025.1');
    expect(resolveRuleSet([approved, older], 'TH_SOCIAL_SECURITY', '2026-06-01')?.version).toBe('2026.1');
  });

  it('reports which rule types have no published set', () => {
    const outcome = ruleParameters([approved], '2026-08-01', [
      'TH_SOCIAL_SECURITY',
      'TH_PIT_WITHHOLDING',
    ]);
    expect(outcome.parameters['sso_employee_rate']).toBe('0.05');
    expect(outcome.missing).toEqual(['TH_PIT_WITHHOLDING']);
  });
});

describe('payroll run state machine', () => {
  it('allows the documented forward path', () => {
    const path = ['DRAFT', 'CALCULATING', 'CALCULATED', 'REVIEW', 'APPROVED', 'LOCKED'] as const;
    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index] as never, path[index + 1] as never)).toBe(true);
    }
  });

  it('allows the documented backward paths only', () => {
    expect(canTransition('CALCULATED', 'DRAFT')).toBe(true);
    expect(canTransition('REVIEW', 'DRAFT')).toBe(true);
    expect(canTransition('FAILED', 'DRAFT')).toBe(true);
    // ห้ามย้อนกลับจาก LOCKED (spec §10)
    expect(canTransition('LOCKED', 'DRAFT')).toBe(false);
    expect(canTransition('PAID', 'APPROVED')).toBe(false);
  });

  it('rejects an undeclared transition with the allowed set', () => {
    expect(() => assertTransition('DRAFT', 'APPROVED')).toThrow(/cannot move from DRAFT to APPROVED/);
  });

  it('treats every post-lock status as immutable', () => {
    for (const status of ['LOCKED', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'FILED', 'VOID'] as const) {
      expect(isLocked(status)).toBe(true);
      expect(() => assertMutable(status, 'edit')).toThrow(/immutable/);
    }
    for (const status of ['DRAFT', 'CALCULATED', 'REVIEW', 'APPROVED'] as const) {
      expect(isLocked(status)).toBe(false);
      expect(() => assertMutable(status, 'edit')).not.toThrow();
    }
  });
});

describe('submission validation', () => {
  const clean = {
    hasClosedTimesheetSnapshot: true,
    employeeCount: 5,
    negativeNetCount: 0,
    calculationErrorCount: 0,
    unresolvedBlockingExceptions: 0,
    missingRuleSets: [] as string[],
    snapshotHashMatches: true,
    waivedCodes: [] as string[],
  };

  it('passes a clean run', () => {
    expect(validateForSubmission(clean)).toEqual([]);
  });

  it('blocks a run built from an open timesheet', () => {
    const problems = validateForSubmission({ ...clean, hasClosedTimesheetSnapshot: false });
    expect(problems.map((problem) => problem.code)).toContain('NO_CLOSED_TIMESHEET');
  });

  it('blocks negative net pay and refuses to let it be waived', () => {
    const problems = validateForSubmission({
      ...clean,
      negativeNetCount: 2,
      waivedCodes: ['NEGATIVE_NET_PAY'],
    });
    expect(problems.map((problem) => problem.code)).toContain('NEGATIVE_NET_PAY');
  });

  it('blocks when a required rule set has no published version', () => {
    const problems = validateForSubmission({ ...clean, missingRuleSets: ['TH_PIT_WITHHOLDING'] });
    expect(problems[0]?.code).toBe('MISSING_RULE_SETS');
  });

  it('blocks on snapshot drift', () => {
    const problems = validateForSubmission({ ...clean, snapshotHashMatches: false });
    expect(problems.map((problem) => problem.code)).toContain('SNAPSHOT_DRIFT');
  });

  it('allows blocking attendance exceptions to be waived with a reason', () => {
    const withExceptions = validateForSubmission({ ...clean, unresolvedBlockingExceptions: 3 });
    expect(withExceptions.map((problem) => problem.code)).toContain('BLOCKING_ATTENDANCE_EXCEPTIONS');

    const waived = validateForSubmission({
      ...clean,
      unresolvedBlockingExceptions: 3,
      waivedCodes: ['BLOCKING_ATTENDANCE_EXCEPTIONS'],
    });
    expect(waived).toEqual([]);
  });
});
