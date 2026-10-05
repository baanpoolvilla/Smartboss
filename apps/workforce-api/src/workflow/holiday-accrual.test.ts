import { describe, expect, it } from 'vitest';
import { holidayAvailability } from './holiday-accrual';

const grants = new Map([
  ['2026-07', 2],
  ['2026-08', 1],
  ['2026-10', 3],
]);

function available(month: string, usage: [string, number][] = [], to = month): number {
  return holidayAvailability({ from: '2026-01', to, grants, usage: new Map(usage) }, month).available_days;
}

describe('holidayAvailability', () => {
  it('ให้สิทธิ์ตามเดือนนั้น และทบจากเดือนก่อนหน้าได้', () => {
    expect(available('2026-07')).toBe(2);
    expect(available('2026-08')).toBe(3);
    expect(available('2026-09')).toBe(3);
  });

  it('ใช้ได้ภายใน 3 เดือนนับรวมเดือนที่ได้สิทธิ์ เกินนั้นตัดทิ้ง', () => {
    // ต.ค. — ของ ก.ค. หมดอายุสิ้น ก.ย. แล้ว เหลือ ส.ค.(1) + ต.ค.(3)
    expect(available('2026-10')).toBe(4);
    // พ.ย. — ของ ส.ค. หมดอายุสิ้น ต.ค.
    expect(available('2026-11')).toBe(3);
    // ของ ต.ค. ใช้ได้ถึงสิ้น ธ.ค.
    expect(available('2026-12')).toBe(3);
    expect(available('2027-01')).toBe(0);
  });

  it('ตัดจากสิทธิ์ที่เก่าที่สุดก่อน', () => {
    // ใช้ 2 วันใน ส.ค. → ตัดของ ก.ค. หมด เหลือของ ส.ค. 1 วัน ใช้ต่อได้ถึง ต.ค.
    expect(available('2026-09', [['2026-08', 2]])).toBe(1);
    expect(available('2026-10', [['2026-08', 2]])).toBe(4);
    expect(available('2026-11', [['2026-08', 2]])).toBe(3);
  });

  it('วันที่จองล่วงหน้าในเดือนถัดไปกันสิทธิ์ที่ทบมาไว้แล้ว', () => {
    // ก.ย. จองไว้ 3 วัน (ใช้สิทธิ์ ก.ค.+ส.ค. หมด) → ส.ค. ลงเพิ่มไม่ได้แล้ว
    expect(available('2026-08', [['2026-09', 3]], '2026-09')).toBe(0);
    expect(available('2026-08', [['2026-09', 2]], '2026-09')).toBe(1);
  });

  it('การใช้เกินในอดีตไม่ทบเป็นหนี้', () => {
    expect(available('2026-10', [['2026-03', 5]])).toBe(4);
  });

  it('ก่อนเดือนที่เริ่มนับไม่มีสิทธิ์', () => {
    expect(holidayAvailability({ from: '2026-09', to: '2026-10', grants, usage: new Map() }, '2026-08').available_days).toBe(0);
    // เริ่มงาน ก.ย. — ไม่ได้สิทธิ์ของ ก.ค./ส.ค.
    expect(holidayAvailability({ from: '2026-09', to: '2026-10', grants, usage: new Map() }, '2026-10').available_days).toBe(3);
  });
});
