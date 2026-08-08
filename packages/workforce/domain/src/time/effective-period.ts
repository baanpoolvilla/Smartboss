import { LocalDate } from './local-date';

export class InvalidEffectivePeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEffectivePeriodError';
  }
}

/**
 * ช่วงเวลาที่มีผล แบบ inclusive ทั้งสองด้าน `[from, to]`
 * `to = null` แปลว่ายังมีผลอยู่ (open-ended)
 *
 * ตรงกับ `daterange(effective_from, effective_to, '[]')` ที่ใช้ใน
 * exclusion constraint ของ DB (ADR-0012)
 */
export class EffectivePeriod {
  private constructor(
    readonly from: LocalDate,
    readonly to: LocalDate | null,
  ) {}

  static of(from: LocalDate, to: LocalDate | null = null): EffectivePeriod {
    if (to !== null && to.isBefore(from)) {
      throw new InvalidEffectivePeriodError(
        `effective_to (${to.toString()}) must not be before effective_from (${from.toString()})`,
      );
    }
    return new EffectivePeriod(from, to);
  }

  static parse(from: string, to: string | null = null): EffectivePeriod {
    return EffectivePeriod.of(LocalDate.parse(from), to === null ? null : LocalDate.parse(to));
  }

  isOpenEnded(): boolean {
    return this.to === null;
  }

  contains(date: LocalDate): boolean {
    if (date.isBefore(this.from)) return false;
    return this.to === null || date.isOnOrBefore(this.to);
  }

  overlaps(other: EffectivePeriod): boolean {
    const startsAfterOtherEnds = other.to !== null && this.from.isAfter(other.to);
    const endsBeforeOtherStarts = this.to !== null && other.from.isAfter(this.to);
    return !startsAfterOtherEnds && !endsBeforeOtherStarts;
  }

  /** ปิดช่วงนี้ที่วันก่อนหน้าที่ช่วงใหม่จะเริ่ม — ใช้ตอนแก้ค่าแบบ effective-dated */
  closeBefore(nextFrom: LocalDate): EffectivePeriod {
    if (nextFrom.isOnOrBefore(this.from)) {
      throw new InvalidEffectivePeriodError(
        `cannot close period starting ${this.from.toString()} before ${nextFrom.toString()}`,
      );
    }
    return EffectivePeriod.of(this.from, nextFrom.minusDays(1));
  }

  toString(): string {
    return `[${this.from.toString()}, ${this.to?.toString() ?? '∞'}]`;
  }

  toJSON(): { effective_from: string; effective_to: string | null } {
    return { effective_from: this.from.toString(), effective_to: this.to?.toString() ?? null };
  }
}

/**
 * เลือกแถวที่มีผล ณ วันที่ที่ระบุ (point-in-time resolution)
 *
 * ห้ามใช้ "แถวล่าสุด" แทน — คำนวณงวดเก่าใหม่ต้องได้ผลเดิม (ADR-0012 ข้อ 2)
 */
export function resolveAsOf<T>(
  rows: readonly T[],
  asOf: LocalDate,
  periodOf: (row: T) => EffectivePeriod,
): T | undefined {
  let best: { row: T; from: LocalDate } | undefined;

  for (const row of rows) {
    const period = periodOf(row);
    if (!period.contains(asOf)) continue;
    if (best === undefined || period.from.isAfter(best.from)) {
      best = { row, from: period.from };
    }
  }

  return best?.row;
}

/** ตรวจว่ามีช่วงใดทับซ้อนกันหรือไม่ — ชั้นป้องกันฝั่ง application คู่กับ DB constraint */
export function findOverlap(
  periods: readonly EffectivePeriod[],
): { left: EffectivePeriod; right: EffectivePeriod } | undefined {
  for (let i = 0; i < periods.length; i += 1) {
    for (let j = i + 1; j < periods.length; j += 1) {
      const left = periods[i]!;
      const right = periods[j]!;
      if (left.overlaps(right)) return { left, right };
    }
  }
  return undefined;
}
