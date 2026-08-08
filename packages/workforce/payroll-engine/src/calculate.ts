import { Money, Rate, type RoundingMode } from '@workforce/domain';
import {
  evaluateFormula,
  topologicalOrder,
  type FormulaContext,
  type FormulaNode,
  type FormulaValue,
  type TraceStep,
} from './formula';

export type PayItemCategory =
  | 'EARNING'
  | 'DEDUCTION'
  | 'BENEFIT'
  | 'EMPLOYER_CONTRIBUTION'
  | 'INFORMATION';

export type CalculationType =
  | 'FIXED'
  | 'MANUAL'
  | 'FORMULA'
  | 'ATTENDANCE'
  | 'PERCENTAGE'
  | 'IMPORT'
  | 'BALANCE_LEDGER';

export interface PayItemDefinition {
  code: string;
  name: string;
  category: PayItemCategory;
  calculationType: CalculationType;
  formula: FormulaNode | null;
  /** false = แสดงเป็นข้อมูลอย่างเดียว ไม่กระทบยอดสุทธิ (spec §9.2) */
  affectsNetPay: boolean;
  taxable: boolean;
  socialSecurityBase: boolean;
  providentFundBase: boolean;
  /** true = นายจ้างจ่าย ไม่หักจากลูกจ้าง และไม่เข้ายอดสุทธิ */
  employerOnly: boolean;
  roundingDecimals: number;
  roundingMode: RoundingMode;
  displayOrder: number;
}

export interface EmploymentSnapshot {
  employmentId: string;
  currency: string;
  /** ค่าจาก timesheet snapshot + compensation ที่ freeze ไว้แล้ว */
  variables: Readonly<Record<string, FormulaValue>>;
  /** จำนวนเงินที่กรอกมือหรือ import สำหรับ pay item ประเภท MANUAL/IMPORT */
  manualAmounts: Readonly<Record<string, string>>;
}

export interface PayrollLine {
  code: string;
  name: string;
  category: PayItemCategory;
  amount: Money;
  taxable: boolean;
  affectsNetPay: boolean;
  employerOnly: boolean;
  displayOrder: number;
  trace: {
    calculation_type: CalculationType;
    rounding: string;
    pre_round: string;
    steps: TraceStep[];
  };
}

export interface PayrollWarning {
  code: 'NEGATIVE_NET_PAY' | 'MISSING_MANUAL_AMOUNT' | 'FORMULA_ERROR' | 'ZERO_GROSS';
  detail: string;
  itemCode?: string;
}

export interface EmployeePayrollResult {
  employmentId: string;
  currency: string;
  lines: PayrollLine[];
  gross: Money;
  totalDeduction: Money;
  employerContribution: Money;
  net: Money;
  taxableBase: Money;
  socialSecurityBase: Money;
  providentFundBase: Money;
  warnings: PayrollWarning[];
}

/**
 * คำนวณเงินเดือนของพนักงานหนึ่งคนจาก snapshot
 *
 * เป็น pure function: ไม่อ่านนาฬิกา ไม่แตะ DB ไม่สุ่ม — spec §17 กำหนดว่า
 * snapshot เดิม + rule เดิม ต้องได้ผลเดิม 100%
 *
 * `sum(lines ที่ปัดแล้ว) === gross/total_deduction/net` เสมอ เพราะรวมจากบรรทัด
 * ที่ปัดแล้ว ไม่ใช่ปัดใหม่จากผลรวมดิบ (ADR-0007, spec §19.5)
 */
export function calculatePayroll(
  snapshot: EmploymentSnapshot,
  definitions: readonly PayItemDefinition[],
): EmployeePayrollResult {
  const order = topologicalOrder(
    definitions.map((item) => ({ code: item.code, formula: item.formula })),
  );
  const byCode = new Map(definitions.map((item) => [item.code, item]));

  const lines: PayrollLine[] = [];
  const warnings: PayrollWarning[] = [];
  const computed: Record<string, Money> = {};

  for (const code of order) {
    const definition = byCode.get(code);
    if (definition === undefined) continue;

    const outcome = calculateLine(definition, snapshot, computed, warnings);
    computed[code] = outcome.amount;
    lines.push(outcome);
  }

  lines.sort((left, right) => left.displayOrder - right.displayOrder);

  const zero = Money.zero(snapshot.currency);
  const sumWhere = (predicate: (line: PayrollLine) => boolean): Money =>
    Money.sum(lines.filter(predicate).map((line) => line.amount), snapshot.currency);

  const gross = sumWhere(
    (line) => line.category === 'EARNING' && line.affectsNetPay && !line.employerOnly,
  );
  const totalDeduction = sumWhere(
    (line) => line.category === 'DEDUCTION' && line.affectsNetPay && !line.employerOnly,
  );
  const employerContribution = sumWhere(
    (line) => line.category === 'EMPLOYER_CONTRIBUTION' || line.employerOnly,
  );

  const taxableBase = sumWhere((line) => line.taxable && line.category === 'EARNING');
  const socialSecurityBase = sumWhere(
    (line) => byCode.get(line.code)?.socialSecurityBase === true && line.category === 'EARNING',
  );
  const providentFundBase = sumWhere(
    (line) => byCode.get(line.code)?.providentFundBase === true && line.category === 'EARNING',
  );

  const net = gross.subtract(totalDeduction);

  if (net.isNegative()) {
    // spec §10.2: negative net pay ต้องถูกแก้ก่อนอนุมัติ ไม่ใช่จ่ายติดลบ
    warnings.push({
      code: 'NEGATIVE_NET_PAY',
      detail: `net pay is ${net.toFixed(2)}; deductions exceed earnings`,
    });
  }
  if (gross.equals(zero) && lines.length > 0) {
    warnings.push({ code: 'ZERO_GROSS', detail: 'no earnings were produced for this employment' });
  }

  return {
    employmentId: snapshot.employmentId,
    currency: snapshot.currency,
    lines,
    gross,
    totalDeduction,
    employerContribution,
    net,
    taxableBase,
    socialSecurityBase,
    providentFundBase,
    warnings,
  };
}

function calculateLine(
  definition: PayItemDefinition,
  snapshot: EmploymentSnapshot,
  computed: Readonly<Record<string, Money>>,
  warnings: PayrollWarning[],
): PayrollLine {
  const zero = Money.zero(snapshot.currency);
  let preRound = zero;
  let steps: TraceStep[] = [];

  switch (definition.calculationType) {
    case 'MANUAL':
    case 'IMPORT': {
      const manual = snapshot.manualAmounts[definition.code];
      if (manual === undefined) {
        // ไม่มีค่าที่กรอกมา = 0 แต่ต้องเตือน ไม่ใช่เงียบ
        warnings.push({
          code: 'MISSING_MANUAL_AMOUNT',
          detail: `no amount was provided for ${definition.code}`,
          itemCode: definition.code,
        });
      } else {
        preRound = Money.of(manual, snapshot.currency);
      }
      steps = [
        {
          node: definition.calculationType.toLowerCase(),
          detail: { provided: manual ?? null },
          result: preRound.toString(),
        },
      ];
      break;
    }

    case 'FIXED':
    case 'FORMULA':
    case 'ATTENDANCE':
    case 'PERCENTAGE':
    case 'BALANCE_LEDGER': {
      if (definition.formula === null) {
        warnings.push({
          code: 'FORMULA_ERROR',
          detail: `${definition.code} has calculation type ${definition.calculationType} but no formula`,
          itemCode: definition.code,
        });
        break;
      }

      const context: FormulaContext = {
        variables: snapshot.variables,
        items: computed,
        currency: snapshot.currency,
      };

      try {
        const evaluated = evaluateFormula(definition.formula, context);
        steps = evaluated.trace;
        preRound =
          evaluated.value.type === 'money'
            ? evaluated.value.value
            : // สูตรที่คืน rate ต้องถูกแปลงเป็นเงินอย่างชัดเจนในสูตรเอง
              (() => {
                warnings.push({
                  code: 'FORMULA_ERROR',
                  detail: `${definition.code} produced a rate; a pay item must resolve to money`,
                  itemCode: definition.code,
                });
                return zero;
              })();
      } catch (error) {
        warnings.push({
          code: 'FORMULA_ERROR',
          detail: error instanceof Error ? error.message : String(error),
          itemCode: definition.code,
        });
      }
      break;
    }
  }

  // ปัดครั้งเดียวที่ปลายของ pay item ตาม rounding ที่ item ประกาศไว้ (spec §9.2)
  const amount = preRound.round(definition.roundingDecimals, definition.roundingMode);

  return {
    code: definition.code,
    name: definition.name,
    category: definition.category,
    amount,
    taxable: definition.taxable,
    affectsNetPay: definition.affectsNetPay,
    employerOnly: definition.employerOnly,
    displayOrder: definition.displayOrder,
    trace: {
      calculation_type: definition.calculationType,
      rounding: `${definition.roundingMode}_${String(definition.roundingDecimals)}`,
      pre_round: preRound.toString(),
      steps,
    },
  };
}

/** สร้างตัวแปรของสูตรจากตัวเลขใน snapshot */
export function buildVariables(input: {
  currency: string;
  money: Readonly<Record<string, string>>;
  quantities: Readonly<Record<string, number>>;
}): Record<string, FormulaValue> {
  const variables: Record<string, FormulaValue> = {};

  for (const [name, value] of Object.entries(input.money)) {
    variables[name] = { type: 'money', value: Money.of(value, input.currency) };
  }
  for (const [name, value] of Object.entries(input.quantities)) {
    variables[name] = { type: 'rate', value: Rate.of(String(value)) };
  }

  return variables;
}

/**
 * ตรวจว่าผลลัพธ์สองครั้งเหมือนกันจริง
 * ใช้ยืนยัน determinism ก่อน lock (spec §19.5)
 */
export function resultDigest(result: EmployeePayrollResult): string {
  return JSON.stringify({
    employment: result.employmentId,
    lines: result.lines.map((line) => [line.code, line.amount.toString()]),
    gross: result.gross.toString(),
    deduction: result.totalDeduction.toString(),
    net: result.net.toString(),
  });
}
