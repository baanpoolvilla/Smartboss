import { describe, expect, it } from 'vitest';
import {
  EffectivePeriod,
  findOverlap,
  InvalidEffectivePeriodError,
  resolveAsOf,
} from './effective-period';
import { LocalDate } from './local-date';

const date = (value: string): LocalDate => LocalDate.parse(value);

describe('LocalDate', () => {
  it('rejects dates that do not exist', () => {
    expect(() => date('2026-02-30')).toThrow();
    expect(() => date('2026-13-01')).toThrow();
    expect(() => date('2026-1-1')).toThrow();
    expect(date('2028-02-29').toString()).toBe('2028-02-29');
  });

  it('handles month arithmetic at month-end', () => {
    expect(date('2026-01-31').plusMonths(1).toString()).toBe('2026-02-28');
    expect(date('2026-12-31').plusMonths(1).toString()).toBe('2027-01-31');
    expect(date('2026-08-31').lastDayOfMonth().toString()).toBe('2026-08-31');
  });

  it('derives the calendar date in a given time zone', () => {
    // 2026-08-01T00:30Z คือ 07:30 ของวันที่ 1 ส.ค. ที่กรุงเทพ
    const instant = new Date('2026-08-01T00:30:00Z');
    expect(LocalDate.fromInstant(instant, 'Asia/Bangkok').toString()).toBe('2026-08-01');

    // แต่ 2026-07-31T18:30Z ยังเป็นวันที่ 31 ก.ค. ที่ UTC และเป็นวันที่ 1 ส.ค. ที่กรุงเทพแล้ว
    // นี่คือ date boundary ที่ระบบเดิมพลาดจากการบวก 7 ชั่วโมงด้วยมือ (spec §3.3 A4)
    const boundary = new Date('2026-07-31T18:30:00Z');
    expect(LocalDate.fromInstant(boundary, 'UTC').toString()).toBe('2026-07-31');
    expect(LocalDate.fromInstant(boundary, 'Asia/Bangkok').toString()).toBe('2026-08-01');
  });

  it('counts days across a month boundary', () => {
    expect(date('2026-07-31').daysUntil(date('2026-08-01'))).toBe(1);
    expect(date('2026-08-01').daysUntil(date('2026-07-31'))).toBe(-1);
  });
});

describe('EffectivePeriod', () => {
  it('rejects a period that ends before it starts', () => {
    expect(() => EffectivePeriod.parse('2026-08-01', '2026-07-31')).toThrow(
      InvalidEffectivePeriodError,
    );
  });

  it('treats both ends as inclusive', () => {
    const period = EffectivePeriod.parse('2026-08-01', '2026-08-31');
    expect(period.contains(date('2026-08-01'))).toBe(true);
    expect(period.contains(date('2026-08-31'))).toBe(true);
    expect(period.contains(date('2026-07-31'))).toBe(false);
    expect(period.contains(date('2026-09-01'))).toBe(false);
  });

  it('treats a null end as still effective', () => {
    const period = EffectivePeriod.parse('2026-08-01', null);
    expect(period.isOpenEnded()).toBe(true);
    expect(period.contains(date('2099-01-01'))).toBe(true);
  });

  it('detects overlap including single-day touches', () => {
    const august = EffectivePeriod.parse('2026-08-01', '2026-08-31');
    expect(august.overlaps(EffectivePeriod.parse('2026-08-31', '2026-09-30'))).toBe(true);
    expect(august.overlaps(EffectivePeriod.parse('2026-09-01', '2026-09-30'))).toBe(false);
    expect(august.overlaps(EffectivePeriod.parse('2026-07-01', '2026-07-31'))).toBe(false);
    expect(august.overlaps(EffectivePeriod.parse('2026-01-01', null))).toBe(true);
  });

  it('closes a period the day before the next one starts', () => {
    const open = EffectivePeriod.parse('2026-01-01', null);
    const closed = open.closeBefore(date('2026-08-01'));
    expect(closed.to?.toString()).toBe('2026-07-31');
    expect(closed.overlaps(EffectivePeriod.parse('2026-08-01', null))).toBe(false);
  });

  it('refuses to close a period before it began', () => {
    const period = EffectivePeriod.parse('2026-08-01', null);
    expect(() => period.closeBefore(date('2026-07-01'))).toThrow(InvalidEffectivePeriodError);
    expect(() => period.closeBefore(date('2026-08-01'))).toThrow(InvalidEffectivePeriodError);
  });
});

describe('resolveAsOf', () => {
  interface Rate {
    amount: string;
    from: string;
    to: string | null;
  }

  const rates: Rate[] = [
    { amount: '24000', from: '2024-03-01', to: '2025-12-31' },
    { amount: '30000', from: '2026-01-01', to: '2026-07-31' },
    { amount: '33000', from: '2026-08-01', to: null },
  ];

  const period = (rate: Rate): EffectivePeriod => EffectivePeriod.parse(rate.from, rate.to);

  it('returns the row effective on the given date, not the latest row', () => {
    // นี่คือคุณสมบัติที่ระบบเดิมไม่มี: คำนวณงวดเก่าใหม่แล้วต้องได้ค่าเดิม (ADR-0012)
    expect(resolveAsOf(rates, date('2026-06-15'), period)?.amount).toBe('30000');
    expect(resolveAsOf(rates, date('2026-08-15'), period)?.amount).toBe('33000');
    expect(resolveAsOf(rates, date('2024-06-01'), period)?.amount).toBe('24000');
  });

  it('returns nothing before any period starts', () => {
    expect(resolveAsOf(rates, date('2020-01-01'), period)).toBeUndefined();
  });

  it('finds overlaps in a set', () => {
    const clean = rates.map(period);
    expect(findOverlap(clean)).toBeUndefined();

    const dirty = [...clean, EffectivePeriod.parse('2026-07-01', '2026-09-01')];
    expect(findOverlap(dirty)).toBeDefined();
  });
});
