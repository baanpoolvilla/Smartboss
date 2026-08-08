/**
 * Rounding mode — ต้องระบุเสมอ ไม่มีค่า default โดยปริยาย (ADR-0007)
 *
 * pay item แต่ละตัวประกาศ rounding ของตัวเองใน definition (spec §9.2)
 * และ calculation trace บันทึกว่าใช้โหมดไหน (spec §9.4)
 */
export type RoundingMode =
  | 'HALF_UP'
  | 'HALF_DOWN'
  | 'HALF_EVEN'
  | 'UP'
  | 'DOWN'
  | 'FLOOR'
  | 'CEILING';

export const ROUNDING_MODES: readonly RoundingMode[] = [
  'HALF_UP',
  'HALF_DOWN',
  'HALF_EVEN',
  'UP',
  'DOWN',
  'FLOOR',
  'CEILING',
];

/**
 * หาร bigint พร้อมปัดเศษตามโหมดที่ระบุ
 *
 * BigInt `/` ตัดเศษเข้าหาศูนย์เสมอ จึงต้องคำนวณส่วนที่เหลือเองทุกโหมด
 * @param denominator ต้องมากกว่า 0
 */
export function divideWithRounding(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator <= 0n) {
    throw new RangeError('divideWithRounding: denominator must be positive');
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;

  const negative = numerator < 0n;
  const awayFromZero = negative ? quotient - 1n : quotient + 1n;
  const twiceRemainder = (negative ? -remainder : remainder) * 2n;

  switch (mode) {
    case 'DOWN':
      return quotient;
    case 'UP':
      return awayFromZero;
    case 'FLOOR':
      return negative ? quotient - 1n : quotient;
    case 'CEILING':
      return negative ? quotient : quotient + 1n;
    case 'HALF_UP':
      return twiceRemainder >= denominator ? awayFromZero : quotient;
    case 'HALF_DOWN':
      return twiceRemainder > denominator ? awayFromZero : quotient;
    case 'HALF_EVEN': {
      if (twiceRemainder > denominator) return awayFromZero;
      if (twiceRemainder < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : awayFromZero;
    }
    default: {
      const exhaustive: never = mode;
      throw new RangeError(`unknown rounding mode: ${String(exhaustive)}`);
    }
  }
}

export function pow10(exponent: number): bigint {
  if (exponent < 0) throw new RangeError('pow10: exponent must be >= 0');
  return 10n ** BigInt(exponent);
}
