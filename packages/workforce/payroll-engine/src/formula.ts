import { Money, Rate, type RoundingMode } from '@workforce/domain';

/**
 * Formula DSL แบบ AST (spec §9.4)
 *
 * ห้ามใช้ `eval`, JavaScript expression หรือ SQL ที่ผู้ใช้กรอก (spec §21) —
 * สูตรเงินเดือนที่ผู้ใช้แก้ได้คือช่องทางรันโค้ดบนเซิร์ฟเวอร์ถ้าประเมินด้วย eval
 *
 * AST นี้:
 *   - ประเมินได้เฉพาะ node ที่ประกาศไว้ ไม่มีทางเรียกอะไรนอกรายการ
 *   - ใช้ decimal arithmetic ล้วน ไม่มี float
 *   - deterministic: input เดิม → ผลเดิม ไม่อ่านนาฬิกา ไม่สุ่ม
 *   - อธิบายได้ทุกขั้นตอนผ่าน trace
 */

export type FormulaNode =
  | { kind: 'money'; value: string }
  | { kind: 'rate'; value: string }
  /** ค่าจาก snapshot เช่น base_salary, worked_minutes */
  | { kind: 'var'; name: string }
  /** ผลลัพธ์ของ pay item อื่นที่คำนวณไปแล้ว */
  | { kind: 'item'; code: string }
  | { kind: 'add'; left: FormulaNode; right: FormulaNode }
  | { kind: 'subtract'; left: FormulaNode; right: FormulaNode }
  /** เงิน × อัตรา — เงิน × เงิน เป็น error โดยเจตนา */
  | { kind: 'multiply'; money: FormulaNode; rate: FormulaNode }
  | { kind: 'divide'; money: FormulaNode; rate: FormulaNode }
  | { kind: 'min'; values: FormulaNode[] }
  | { kind: 'max'; values: FormulaNode[] }
  /** จำกัดค่าไม่ให้เกินเพดาน เช่น เพดานเงินสมทบประกันสังคม */
  | { kind: 'cap'; value: FormulaNode; ceiling: FormulaNode }
  | { kind: 'floor_at'; value: FormulaNode; minimum: FormulaNode }
  | { kind: 'round'; value: FormulaNode; decimals: number; mode: RoundingMode }
  /** แปลงนาทีเป็นชั่วโมง เช่น 90 นาที → 1.5 */
  | { kind: 'minutes_to_hours'; minutes: FormulaNode }
  | { kind: 'if_positive'; test: FormulaNode; then: FormulaNode; otherwise: FormulaNode }
  | {
      kind: 'bracket';
      value: FormulaNode;
      /** ขั้นบันได: ขนาดของแต่ละขั้น (null = ไม่จำกัด) และอัตราของขั้นนั้น */
      brackets: { size: string | null; rate: string }[];
    };

export type FormulaValue = { type: 'money'; value: Money } | { type: 'rate'; value: Rate };

export interface FormulaContext {
  /** ค่าจาก snapshot — เงินเป็น Money, ปริมาณเป็น Rate */
  variables: Readonly<Record<string, FormulaValue>>;
  /** ผลลัพธ์ของ pay item ที่คำนวณเสร็จแล้วในรอบเดียวกัน */
  items: Readonly<Record<string, Money>>;
  currency: string;
}

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

export interface TraceStep {
  node: string;
  detail: Record<string, unknown>;
  result: string;
}

export interface EvaluationResult {
  value: FormulaValue;
  trace: TraceStep[];
}

export function evaluateFormula(node: FormulaNode, context: FormulaContext): EvaluationResult {
  const trace: TraceStep[] = [];
  const value = evaluate(node, context, trace);
  return { value, trace };
}

/** ดึงชื่อ variable และ pay item ที่สูตรอ้างถึง — ใช้สร้าง dependency graph */
export function collectReferences(node: FormulaNode): { variables: string[]; items: string[] } {
  const variables = new Set<string>();
  const items = new Set<string>();

  const walk = (current: FormulaNode): void => {
    switch (current.kind) {
      case 'money':
      case 'rate':
        return;
      case 'var':
        variables.add(current.name);
        return;
      case 'item':
        items.add(current.code);
        return;
      case 'add':
      case 'subtract':
        walk(current.left);
        walk(current.right);
        return;
      case 'multiply':
      case 'divide':
        walk(current.money);
        walk(current.rate);
        return;
      case 'min':
      case 'max':
        current.values.forEach(walk);
        return;
      case 'cap':
        walk(current.value);
        walk(current.ceiling);
        return;
      case 'floor_at':
        walk(current.value);
        walk(current.minimum);
        return;
      case 'round':
      case 'bracket':
        walk(current.value);
        return;
      case 'minutes_to_hours':
        walk(current.minutes);
        return;
      case 'if_positive':
        walk(current.test);
        walk(current.then);
        walk(current.otherwise);
        return;
    }
  };

  walk(node);
  return { variables: [...variables], items: [...items] };
}

function evaluate(node: FormulaNode, context: FormulaContext, trace: TraceStep[]): FormulaValue {
  switch (node.kind) {
    case 'money':
      return { type: 'money', value: Money.of(node.value, context.currency) };

    case 'rate':
      return { type: 'rate', value: Rate.of(node.value) };

    case 'var': {
      const found = context.variables[node.name];
      if (found === undefined) {
        // ตัวแปรที่ไม่มีใน snapshot ต้องเป็น error ไม่ใช่ 0 เงียบ ๆ
        throw new FormulaError(`unknown variable: ${node.name}`);
      }
      trace.push({ node: 'var', detail: { name: node.name }, result: found.value.toString() });
      return found;
    }

    case 'item': {
      const found = context.items[node.code];
      if (found === undefined) {
        throw new FormulaError(`pay item ${node.code} has not been calculated yet`);
      }
      trace.push({ node: 'item', detail: { code: node.code }, result: found.toString() });
      return { type: 'money', value: found };
    }

    case 'add':
    case 'subtract': {
      const left = evaluate(node.left, context, trace);
      const right = evaluate(node.right, context, trace);
      const result = combine(node.kind, left, right);
      trace.push({
        node: node.kind,
        detail: { left: left.value.toString(), right: right.value.toString() },
        result: result.value.toString(),
      });
      return result;
    }

    case 'multiply':
    case 'divide': {
      const money = expectMoney(evaluate(node.money, context, trace), node.kind);
      const rate = expectRate(evaluate(node.rate, context, trace), node.kind);
      // ปัดที่ปลายสุดของ pay item เท่านั้น — ระหว่างทางเก็บความแม่นยำเต็ม (ADR-0007)
      const result =
        node.kind === 'multiply'
          ? money.multiply(rate, 'HALF_EVEN')
          : money.divide(rate, 'HALF_EVEN');
      trace.push({
        node: node.kind,
        detail: { money: money.toString(), rate: rate.toString() },
        result: result.toString(),
      });
      return { type: 'money', value: result };
    }

    case 'min':
    case 'max': {
      if (node.values.length === 0) {
        throw new FormulaError(`${node.kind} requires at least one value`);
      }
      const values = node.values.map((child) => evaluate(child, context, trace));
      let best = values[0] as FormulaValue;
      for (const candidate of values.slice(1)) {
        const comparison = compare(candidate, best);
        if (node.kind === 'min' ? comparison < 0 : comparison > 0) best = candidate;
      }
      trace.push({
        node: node.kind,
        detail: { candidates: values.map((value) => value.value.toString()) },
        result: best.value.toString(),
      });
      return best;
    }

    case 'cap': {
      const value = evaluate(node.value, context, trace);
      const ceiling = evaluate(node.ceiling, context, trace);
      const result = compare(value, ceiling) > 0 ? ceiling : value;
      trace.push({
        node: 'cap',
        detail: { value: value.value.toString(), ceiling: ceiling.value.toString() },
        result: result.value.toString(),
      });
      return result;
    }

    case 'floor_at': {
      const value = evaluate(node.value, context, trace);
      const minimum = evaluate(node.minimum, context, trace);
      const result = compare(value, minimum) < 0 ? minimum : value;
      trace.push({
        node: 'floor_at',
        detail: { value: value.value.toString(), minimum: minimum.value.toString() },
        result: result.value.toString(),
      });
      return result;
    }

    case 'round': {
      const value = expectMoney(evaluate(node.value, context, trace), 'round');
      const result = value.round(node.decimals, node.mode);
      trace.push({
        node: 'round',
        detail: { pre_round: value.toString(), decimals: node.decimals, rounding: node.mode },
        result: result.toString(),
      });
      return { type: 'money', value: result };
    }

    case 'minutes_to_hours': {
      const minutes = expectRate(evaluate(node.minutes, context, trace), 'minutes_to_hours');
      const hours = minutes.multiply(Rate.of('0.016667'), 'HALF_EVEN');
      trace.push({
        node: 'minutes_to_hours',
        detail: { minutes: minutes.toString() },
        result: hours.toString(),
      });
      return { type: 'rate', value: hours };
    }

    case 'if_positive': {
      const test = evaluate(node.test, context, trace);
      const positive = compare(test, zeroLike(test, context)) > 0;
      const branch = positive
        ? evaluate(node.then, context, trace)
        : evaluate(node.otherwise, context, trace);
      trace.push({
        node: 'if_positive',
        detail: { test: test.value.toString(), branch: positive ? 'then' : 'otherwise' },
        result: branch.value.toString(),
      });
      return branch;
    }

    case 'bracket': {
      // ภาษีขั้นบันได: แต่ละขั้นมีขนาดและอัตราของตัวเอง
      const value = expectMoney(evaluate(node.value, context, trace), 'bracket');
      let remaining = value;
      let total = Money.zero(context.currency);
      const steps: Record<string, unknown>[] = [];

      for (const bracket of node.brackets) {
        if (!remaining.isPositive()) break;
        const size = bracket.size === null ? remaining : Money.of(bracket.size, context.currency);
        const taxable = remaining.compare(size) < 0 ? remaining : size;
        const rate = Rate.of(bracket.rate);
        const amount = taxable.multiply(rate, 'HALF_EVEN');
        total = total.add(amount);
        remaining = remaining.subtract(taxable);
        steps.push({
          size: bracket.size,
          rate: bracket.rate,
          taxable: taxable.toString(),
          amount: amount.toString(),
        });
      }

      trace.push({ node: 'bracket', detail: { input: value.toString(), steps }, result: total.toString() });
      return { type: 'money', value: total };
    }

    default: {
      const exhaustive: never = node;
      throw new FormulaError(`unsupported formula node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function combine(
  operation: 'add' | 'subtract',
  left: FormulaValue,
  right: FormulaValue,
): FormulaValue {
  if (left.type === 'money' && right.type === 'money') {
    return {
      type: 'money',
      value: operation === 'add' ? left.value.add(right.value) : left.value.subtract(right.value),
    };
  }
  if (left.type === 'rate' && right.type === 'rate') {
    return {
      type: 'rate',
      value: operation === 'add' ? left.value.add(right.value) : left.value.subtract(right.value),
    };
  }
  throw new FormulaError(`cannot ${operation} a ${left.type} and a ${right.type}`);
}

function compare(left: FormulaValue, right: FormulaValue): number {
  if (left.type === 'money' && right.type === 'money') return left.value.compare(right.value);
  if (left.type === 'rate' && right.type === 'rate') return left.value.compare(right.value);
  throw new FormulaError(`cannot compare a ${left.type} with a ${right.type}`);
}

function zeroLike(sample: FormulaValue, context: FormulaContext): FormulaValue {
  return sample.type === 'money'
    ? { type: 'money', value: Money.zero(context.currency) }
    : { type: 'rate', value: Rate.ZERO };
}

function expectMoney(value: FormulaValue, operation: string): Money {
  if (value.type !== 'money') throw new FormulaError(`${operation} expects a money value`);
  return value.value;
}

function expectRate(value: FormulaValue, operation: string): Rate {
  if (value.type !== 'rate') throw new FormulaError(`${operation} expects a rate value`);
  return value.value;
}

/**
 * เรียงลำดับการคำนวณ pay item ตาม dependency
 * ตรวจ circular dependency ให้ล้มตั้งแต่ตอน publish ไม่ใช่ตอนคำนวณจริง (spec §9.4)
 */
export function topologicalOrder(
  items: readonly { code: string; formula: FormulaNode | null }[],
): string[] {
  const byCode = new Map(items.map((item) => [item.code, item]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  const visit = (code: string, path: string[]): void => {
    if (visited.has(code)) return;
    if (visiting.has(code)) {
      throw new FormulaError(`circular pay item dependency: ${[...path, code].join(' → ')}`);
    }

    const item = byCode.get(code);
    if (item === undefined) throw new FormulaError(`pay item ${code} is referenced but not defined`);

    visiting.add(code);
    if (item.formula !== null) {
      for (const dependency of collectReferences(item.formula).items) {
        visit(dependency, [...path, code]);
      }
    }
    visiting.delete(code);
    visited.add(code);
    order.push(code);
  };

  for (const item of items) visit(item.code, []);
  return order;
}
