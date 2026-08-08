import { LocalDate } from './local-date';

/**
 * เวลาเป็น dependency ไม่ใช่ global
 *
 * payroll ต้อง reproducible 100% (spec §17) ซึ่งเป็นไปไม่ได้ถ้า business logic
 * เรียก `Date.now()` เอง — test จึงฉีด FixedClock เข้าไปแทน
 */
export interface Clock {
  now(): Date;
  today(timeZone: string): LocalDate;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(timeZone: string): LocalDate {
    return LocalDate.fromInstant(this.now(), timeZone);
  }
}

export class FixedClock implements Clock {
  private current: Date;

  constructor(instant: Date | string) {
    this.current = typeof instant === 'string' ? new Date(instant) : instant;
    if (Number.isNaN(this.current.getTime())) {
      throw new RangeError(`FixedClock: invalid instant ${String(instant)}`);
    }
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  today(timeZone: string): LocalDate {
    return LocalDate.fromInstant(this.now(), timeZone);
  }

  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  set(instant: Date | string): void {
    this.current = typeof instant === 'string' ? new Date(instant) : instant;
  }
}

export const DEFAULT_TIME_ZONE = 'Asia/Bangkok';
