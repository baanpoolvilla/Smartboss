import {
  formatScaledToDecimal,
  parseDecimalToScaled,
  truncateExactDecimals,
} from './decimal-string';
import { Rate, RATE_SCALE } from './rate';
import { divideWithRounding, pow10, type RoundingMode } from './rounding';

/** ตรงกับ numeric(19,4) ใน PostgreSQL (ADR-0002) */
export const MONEY_SCALE = 4;
const MONEY_FACTOR = pow10(MONEY_SCALE);
const RATE_FACTOR = pow10(RATE_SCALE);

export class CurrencyMismatchError extends Error {
  constructor(left: string, right: string) {
    super(`cannot combine ${left} with ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

/**
 * จำนวนเงิน เก็บเป็น bigint ที่ scale 4
 *
 * ไม่มี constructor ที่รับ `number` โดยเจตนา — ค่าที่มาถึงเราเป็น number แล้ว
 * อาจเสียความแม่นยำไปก่อนหน้าโดยที่เราตรวจไม่ได้ (ADR-0007)
 */
export class Money {
  private constructor(
    private readonly units: bigint,
    readonly currency: string,
  ) {}

  static of(value: string, currency = 'THB'): Money {
    return new Money(parseDecimalToScaled(value, MONEY_SCALE), currency);
  }

  static fromUnits(units: bigint, currency = 'THB'): Money {
    return new Money(units, currency);
  }

  static zero(currency = 'THB'): Money {
    return new Money(0n, currency);
  }

  /** รวมยอด — ผลรวมของบรรทัดที่ปัดแล้ว ไม่ใช่ปัดใหม่จากผลรวมดิบ (ADR-0007) */
  static sum(values: readonly Money[], currency = 'THB'): Money {
    let total = 0n;
    for (const value of values) {
      value.assertSameCurrency(currency);
      total += value.units;
    }
    return new Money(total, currency);
  }

  toUnits(): bigint {
    return this.units;
  }

  private assertSameCurrency(other: string): void {
    if (this.currency !== other) throw new CurrencyMismatchError(this.currency, other);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other.currency);
    return new Money(this.units + other.units, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other.currency);
    return new Money(this.units - other.units, this.currency);
  }

  negate(): Money {
    return new Money(-this.units, this.currency);
  }

  abs(): Money {
    return new Money(this.units < 0n ? -this.units : this.units, this.currency);
  }

  /** เงิน × อัตรา เช่น ค่าแรงต่อชั่วโมง × ตัวคูณ OT */
  multiply(rate: Rate, mode: RoundingMode): Money {
    return new Money(
      divideWithRounding(this.units * rate.toUnits(), RATE_FACTOR, mode),
      this.currency,
    );
  }

  /** เงิน ÷ อัตรา เช่น เงินเดือน ÷ จำนวนวันทำงานมาตรฐาน */
  divide(rate: Rate, mode: RoundingMode): Money {
    const divisor = rate.toUnits();
    if (divisor === 0n) throw new RangeError('Money.divide: divisor must not be zero');
    const negativeDivisor = divisor < 0n;
    const numerator = this.units * RATE_FACTOR * (negativeDivisor ? -1n : 1n);
    return new Money(
      divideWithRounding(numerator, negativeDivisor ? -divisor : divisor, mode),
      this.currency,
    );
  }

  /** ปัดให้เหลือทศนิยม `decimals` ตำแหน่ง (ค่ายังเก็บที่ scale 4 เหมือนเดิม) */
  round(decimals: number, mode: RoundingMode): Money {
    if (decimals < 0 || decimals > MONEY_SCALE) {
      throw new RangeError(`Money.round: decimals must be 0..${MONEY_SCALE}`);
    }
    const factor = pow10(MONEY_SCALE - decimals);
    if (factor === 1n) return this;
    return new Money(divideWithRounding(this.units, factor, mode) * factor, this.currency);
  }

  /**
   * แบ่งเงินตามน้ำหนักโดยไม่ทำให้ยอดรวมเพี้ยน — เศษที่เหลือจากการปัด
   * กระจายทีละหน่วยย่อยไปยังส่วนแรก ๆ (largest remainder)
   * ใช้ตอนเฉลี่ยค่าใช้จ่ายหรือ pro-rate ข้ามงวด
   */
  allocate(weights: readonly bigint[]): Money[] {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
    if (totalWeight <= 0n) throw new RangeError('Money.allocate: total weight must be positive');

    const shares: bigint[] = [];
    let allocated = 0n;
    for (const weight of weights) {
      const share = (this.units * weight) / totalWeight;
      shares.push(share);
      allocated += share;
    }

    let remainder = this.units - allocated;
    const step = remainder < 0n ? -1n : 1n;
    for (let index = 0; remainder !== 0n && index < shares.length; index += 1) {
      shares[index] = shares[index]! + step;
      remainder -= step;
    }

    return shares.map((share) => new Money(share, this.currency));
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.units === other.units;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other.currency);
    if (this.units < other.units) return -1;
    if (this.units > other.units) return 1;
    return 0;
  }

  /** ค่าเต็มความแม่นยำ scale 4 — รูปแบบที่เขียนลง numeric(19,4) */
  toString(): string {
    return formatScaledToDecimal(this.units, MONEY_SCALE);
  }

  /**
   * Format เป็นจำนวนทศนิยมที่ต้องการ — throw ถ้าค่ายังไม่ถูกปัดมาก่อน
   * บังคับให้การปัดเป็นขั้นตอนที่มองเห็นได้ในโค้ด ไม่ใช่ผลข้างเคียงของการ format
   */
  toFixed(decimals: number): string {
    return truncateExactDecimals(this.toString(), decimals);
  }

  /** API ส่งเงินเป็น string เสมอ (spec §13) */
  toJSON(): string {
    return this.toString();
  }
}
