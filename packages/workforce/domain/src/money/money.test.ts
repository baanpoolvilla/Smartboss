import { describe, expect, it } from 'vitest';
import { DecimalPrecisionError } from './decimal-string';
import { Money } from './money';
import { Rate } from './rate';
import { divideWithRounding } from './rounding';

describe('Money', () => {
  it('parses and round-trips at scale 4', () => {
    expect(Money.of('1875').toString()).toBe('1875.0000');
    expect(Money.of('1875.5').toString()).toBe('1875.5000');
    expect(Money.of('-0.0001').toString()).toBe('-0.0001');
    expect(Money.of('0').toString()).toBe('0.0000');
  });

  it('refuses precision it cannot represent instead of rounding silently', () => {
    // ระบบเดิมปัดเงียบ ๆ ด้วย toFixed หลายชั้น — ที่นี่ต้องประกาศเจตนาให้ชัด
    expect(() => Money.of('1.00005')).toThrow(DecimalPrecisionError);
    expect(() => Money.of('abc')).toThrow(DecimalPrecisionError);
    // ศูนย์ต่อท้ายไม่ถือว่าเสียความแม่นยำ
    expect(Money.of('1.50000').toString()).toBe('1.5000');
  });

  it('adds and subtracts exactly where floating point would drift', () => {
    const sum = Money.of('0.1').add(Money.of('0.2'));
    expect(sum.toString()).toBe('0.3000');
    expect(sum.equals(Money.of('0.3'))).toBe(true);
    // 0.1 + 0.2 === 0.30000000000000004 ในเลขทศนิยมฐานสอง
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('multiplies money by a rate (OT pay case from the spec)', () => {
    // spec §9.4: 10 ชม. × 125 บาท × 1.5
    const hourlyRate = Money.of('125.0000');
    const result = hourlyRate.multiply(Rate.of('10'), 'HALF_UP').multiply(Rate.of('1.5'), 'HALF_UP');
    expect(result.round(2, 'HALF_UP').toFixed(2)).toBe('1875.00');
  });

  it('divides money by a rate (monthly salary to daily rate)', () => {
    const daily = Money.of('30000').divide(Rate.of('30'), 'HALF_UP');
    expect(daily.toFixed(2)).toBe('1000.00');

    const awkward = Money.of('30000').divide(Rate.of('30'), 'HALF_UP').divide(Rate.of('8'), 'HALF_UP');
    expect(awkward.toString()).toBe('125.0000');
  });

  it('rejects division by zero rather than producing Infinity', () => {
    expect(() => Money.of('100').divide(Rate.of('0'), 'HALF_UP')).toThrow(RangeError);
  });

  it('keeps sum(lines) === total, the payslip invariant', () => {
    // spec §19.5: ยอดรวมบน payslip ต้องเท่ากับผลรวมของบรรทัด
    const lines = [
      Money.of('30000.00'),
      Money.of('1875.00'),
      Money.of('1500.00'),
      Money.of('333.33'),
    ];
    const total = Money.sum(lines);
    expect(total.toFixed(2)).toBe('33708.33');

    const recomputed = lines.reduce((acc, line) => acc.add(line), Money.zero());
    expect(recomputed.equals(total)).toBe(true);
  });

  it('refuses to format away unrounded digits', () => {
    const value = Money.of('1875.0050');
    expect(() => value.toFixed(2)).toThrow(DecimalPrecisionError);
    expect(value.round(2, 'HALF_UP').toFixed(2)).toBe('1875.01');
    expect(value.round(2, 'HALF_DOWN').toFixed(2)).toBe('1875.00');
    expect(value.round(2, 'HALF_EVEN').toFixed(2)).toBe('1875.00');
  });

  it('rounds negative amounts symmetrically (deduction case)', () => {
    expect(Money.of('-1875.0050').round(2, 'HALF_UP').toFixed(2)).toBe('-1875.01');
    expect(Money.of('-1875.0050').round(2, 'DOWN').toFixed(2)).toBe('-1875.00');
    expect(Money.of('-1875.0050').round(2, 'FLOOR').toFixed(2)).toBe('-1875.01');
    expect(Money.of('-1875.0050').round(2, 'CEILING').toFixed(2)).toBe('-1875.00');
  });

  it('allocates without losing or inventing money', () => {
    // 100 บาทแบ่ง 3 ส่วนเท่า ๆ กันลงตัวไม่ได้ — เศษต้องไม่หายและไม่งอก
    const parts = Money.of('100.00').allocate([1n, 1n, 1n]);
    expect(parts).toHaveLength(3);
    expect(Money.sum(parts).toString()).toBe('100.0000');
    expect(parts.map((part) => part.toString())).toEqual(['33.3334', '33.3333', '33.3333']);
  });

  it('refuses to mix currencies', () => {
    expect(() => Money.of('1', 'THB').add(Money.of('1', 'USD'))).toThrow();
  });

  it('serialises as a string for JSON transport', () => {
    expect(JSON.parse(JSON.stringify({ amount: Money.of('1875.5') }))).toEqual({
      amount: '1875.5000',
    });
  });
});

describe('divideWithRounding', () => {
  it('handles the half-way boundary for every mode', () => {
    // 5/2 = 2.5 พอดี — จุดที่แต่ละโหมดตัดสินต่างกัน
    expect(divideWithRounding(5n, 2n, 'HALF_UP')).toBe(3n);
    expect(divideWithRounding(5n, 2n, 'HALF_DOWN')).toBe(2n);
    expect(divideWithRounding(5n, 2n, 'HALF_EVEN')).toBe(2n);
    expect(divideWithRounding(7n, 2n, 'HALF_EVEN')).toBe(4n);
    expect(divideWithRounding(-5n, 2n, 'HALF_UP')).toBe(-3n);
    expect(divideWithRounding(-5n, 2n, 'HALF_EVEN')).toBe(-2n);
    expect(divideWithRounding(-5n, 2n, 'FLOOR')).toBe(-3n);
    expect(divideWithRounding(-5n, 2n, 'CEILING')).toBe(-2n);
  });

  it('rejects a non-positive denominator', () => {
    expect(() => divideWithRounding(1n, 0n, 'HALF_UP')).toThrow(RangeError);
  });
});

describe('Rate', () => {
  it('converts percentages', () => {
    expect(Rate.percent('5').toString()).toBe('0.050000');
    expect(Rate.percent('3.5').toString()).toBe('0.035000');
  });

  it('applies a social-security-style percentage to a salary', () => {
    // ตัวเลขตัวอย่างเท่านั้น — อัตราจริงต้องมาจาก statutory_rule_sets (spec §9.5)
    const contribution = Money.of('15000').multiply(Rate.percent('5'), 'HALF_UP');
    expect(contribution.toFixed(2)).toBe('750.00');
  });
});
