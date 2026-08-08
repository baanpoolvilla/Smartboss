const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export class DecimalPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalPrecisionError';
  }
}

/**
 * แปลง decimal string เป็น bigint ที่ scale ที่กำหนด แบบไม่มีการปัดโดยนัย
 *
 * ถ้าค่ามีทศนิยมเกิน scale จะ throw ไม่ปัดให้เงียบ ๆ —
 * การปัดเป็นการตัดสินใจทางธุรกิจที่ต้องเขียนออกมาให้เห็น (ADR-0007)
 */
export function parseDecimalToScaled(value: string, scale: number): bigint {
  if (typeof value !== 'string') {
    throw new TypeError(`expected decimal string, received ${typeof value}`);
  }
  const trimmed = value.trim();
  const match = DECIMAL_RE.exec(trimmed);
  if (!match) {
    throw new DecimalPrecisionError(`invalid decimal string: ${JSON.stringify(value)}`);
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';

  if (fraction.length > scale) {
    const excess = fraction.slice(scale).replace(/0+$/, '');
    if (excess.length > 0) {
      throw new DecimalPrecisionError(
        `value ${trimmed} has more than ${scale} decimal places; round explicitly before constructing`,
      );
    }
  }

  const paddedFraction = fraction.slice(0, scale).padEnd(scale, '0');
  return sign * BigInt(`${whole}${paddedFraction}`);
}

/** แปลง bigint ที่ scale ที่กำหนดกลับเป็น decimal string */
export function formatScaledToDecimal(units: bigint, scale: number): string {
  if (scale === 0) return units.toString();

  const negative = units < 0n;
  const absolute = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = absolute.slice(0, absolute.length - scale);
  const fraction = absolute.slice(absolute.length - scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * ลดจำนวนทศนิยมของ decimal string โดยไม่ปัด — ใช้ตอน format ค่าที่ปัดมาแล้ว
 * ถ้ายังมีตัวเลขที่ไม่ใช่ศูนย์เกินจำนวนที่ขอ จะ throw
 */
export function truncateExactDecimals(decimal: string, decimals: number): string {
  const match = DECIMAL_RE.exec(decimal);
  if (!match) throw new DecimalPrecisionError(`invalid decimal string: ${decimal}`);

  const sign = match[1] === '-' ? '-' : '';
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';

  const dropped = fraction.slice(decimals).replace(/0+$/, '');
  if (dropped.length > 0) {
    throw new DecimalPrecisionError(
      `cannot format ${decimal} to ${decimals} decimals without losing precision; call round() first`,
    );
  }

  if (decimals === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${fraction.slice(0, decimals).padEnd(decimals, '0')}`;
}
