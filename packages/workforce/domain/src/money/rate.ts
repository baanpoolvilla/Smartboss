import { formatScaledToDecimal, parseDecimalToScaled } from './decimal-string';
import { divideWithRounding, pow10, type RoundingMode } from './rounding';

export const RATE_SCALE = 6;
const RATE_FACTOR = pow10(RATE_SCALE);

/**
 * อัตรา/ตัวคูณ/เปอร์เซ็นต์ — เช่น OT multiplier 1.5, PF 3%, อัตราภาษี 5%
 *
 * แยก type จาก Money โดยตั้งใจ: `Money × Money` ต้องเป็น compile error
 * เพราะเงินคูณเงินไม่มีความหมายทางบัญชี (ADR-0007)
 */
export class Rate {
  private constructor(private readonly units: bigint) {}

  static of(value: string): Rate {
    return new Rate(parseDecimalToScaled(value, RATE_SCALE));
  }

  /** สร้างจากเปอร์เซ็นต์ เช่น percent('5') → อัตรา 0.05 */
  static percent(value: string): Rate {
    const scaled = parseDecimalToScaled(value, RATE_SCALE);
    return new Rate(divideWithRounding(scaled, 100n, 'HALF_EVEN'));
  }

  static fromUnits(units: bigint): Rate {
    return new Rate(units);
  }

  static readonly ONE = new Rate(RATE_FACTOR);
  static readonly ZERO = new Rate(0n);

  toUnits(): bigint {
    return this.units;
  }

  multiply(other: Rate, mode: RoundingMode = 'HALF_EVEN'): Rate {
    return new Rate(divideWithRounding(this.units * other.units, RATE_FACTOR, mode));
  }

  add(other: Rate): Rate {
    return new Rate(this.units + other.units);
  }

  subtract(other: Rate): Rate {
    return new Rate(this.units - other.units);
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  equals(other: Rate): boolean {
    return this.units === other.units;
  }

  compare(other: Rate): -1 | 0 | 1 {
    if (this.units < other.units) return -1;
    if (this.units > other.units) return 1;
    return 0;
  }

  toString(): string {
    return formatScaledToDecimal(this.units, RATE_SCALE);
  }

  toJSON(): string {
    return this.toString();
  }
}
