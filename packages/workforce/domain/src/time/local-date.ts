const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export class InvalidDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateError';
  }
}

/**
 * วันที่เชิงธุรกิจที่ไม่มี timezone — เช่น `work_date`, `effective_from`, วันสิ้นงวด
 *
 * แยกจาก `Date` โดยเจตนา: `Date` เป็นจุดเวลาบนไทม์ไลน์ ส่วน "วันที่ทำงาน 1 ส.ค. 2569"
 * ไม่ใช่จุดเวลา — ระบบเดิมปนสองอย่างนี้แล้วต้องบวก 7 ชั่วโมงเองทุกจุด (spec §3.3 A4)
 */
export class LocalDate {
  private constructor(
    readonly year: number,
    readonly month: number,
    readonly day: number,
  ) {}

  static parse(value: string): LocalDate {
    const match = ISO_DATE_RE.exec(value);
    if (!match) throw new InvalidDateError(`expected YYYY-MM-DD, received ${JSON.stringify(value)}`);

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const utc = Date.UTC(year, month - 1, day);
    const check = new Date(utc);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      throw new InvalidDateError(`not a real calendar date: ${value}`);
    }

    return new LocalDate(year, month, day);
  }

  static of(year: number, month: number, day: number): LocalDate {
    return LocalDate.parse(
      `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }

  /**
   * วันที่ปัจจุบันใน timezone ที่ระบุ
   * ต้องส่ง timezone เสมอ — "วันนี้" ไม่มีความหมายถ้าไม่บอกว่าที่ไหน
   */
  static today(timeZone: string, now: Date = new Date()): LocalDate {
    return LocalDate.fromInstant(now, timeZone);
  }

  /** แปลงจุดเวลา (UTC) เป็นวันที่ตามปฏิทินของ timezone ที่ระบุ */
  static fromInstant(instant: Date, timeZone: string): LocalDate {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return LocalDate.parse(formatter.format(instant));
  }

  private toUtcMillis(): number {
    return Date.UTC(this.year, this.month - 1, this.day);
  }

  plusDays(days: number): LocalDate {
    const next = new Date(this.toUtcMillis() + days * MS_PER_DAY);
    return LocalDate.of(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }

  minusDays(days: number): LocalDate {
    return this.plusDays(-days);
  }

  plusMonths(months: number): LocalDate {
    const totalMonths = this.year * 12 + (this.month - 1) + months;
    const year = Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    const lastDay = LocalDate.daysInMonth(year, month);
    return LocalDate.of(year, month, Math.min(this.day, lastDay));
  }

  static daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  firstDayOfMonth(): LocalDate {
    return LocalDate.of(this.year, this.month, 1);
  }

  lastDayOfMonth(): LocalDate {
    return LocalDate.of(this.year, this.month, LocalDate.daysInMonth(this.year, this.month));
  }

  daysUntil(other: LocalDate): number {
    return Math.round((other.toUtcMillis() - this.toUtcMillis()) / MS_PER_DAY);
  }

  /** 0 = อาทิตย์ … 6 = เสาร์ */
  dayOfWeek(): number {
    return new Date(this.toUtcMillis()).getUTCDay();
  }

  compare(other: LocalDate): -1 | 0 | 1 {
    const left = this.toUtcMillis();
    const right = other.toUtcMillis();
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  equals(other: LocalDate): boolean {
    return this.compare(other) === 0;
  }

  isBefore(other: LocalDate): boolean {
    return this.compare(other) === -1;
  }

  isAfter(other: LocalDate): boolean {
    return this.compare(other) === 1;
  }

  isOnOrBefore(other: LocalDate): boolean {
    return this.compare(other) !== 1;
  }

  isOnOrAfter(other: LocalDate): boolean {
    return this.compare(other) !== -1;
  }

  static min(left: LocalDate, right: LocalDate): LocalDate {
    return left.isBefore(right) ? left : right;
  }

  static max(left: LocalDate, right: LocalDate): LocalDate {
    return left.isAfter(right) ? left : right;
  }

  toString(): string {
    return `${String(this.year).padStart(4, '0')}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`;
  }

  toJSON(): string {
    return this.toString();
  }
}
