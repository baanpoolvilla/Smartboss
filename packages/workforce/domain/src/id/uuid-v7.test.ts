import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7, uuidv7Timestamp } from './uuid-v7';

describe('uuidv7', () => {
  it('produces valid UUIDs with version 7 and the RFC 4122 variant', () => {
    for (let index = 0; index < 100; index += 1) {
      const id = uuidv7();
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    }
  });

  it('sorts lexicographically in creation order', () => {
    // คุณสมบัตินี้คือเหตุผลที่เลือก v7: index locality และการเรียงเหตุการณ์ (ADR-0002)
    const ids = Array.from({ length: 500 }, () => uuidv7());
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays ordered within the same millisecond', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7(1_780_000_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });

  it('embeds the creation timestamp', () => {
    // ต้องเป็นเวลาที่ล้ำหน้าทุก id ที่เคยสร้างมาก่อนใน process นี้
    // มิฉะนั้น generator จะ clamp ไปข้างหน้าเพื่อรักษาลำดับ (ดู test ถัดไป)
    const instant = Date.now() + 60_000;
    expect(uuidv7Timestamp(uuidv7(instant)).getTime()).toBe(instant);
  });

  it('never goes backwards when the clock steps back', () => {
    // NTP step ย้อนหลังต้องไม่ทำให้ id ที่สร้างใหม่เรียงก่อน id เดิม
    const before = uuidv7(Date.now() + 3_600_000);
    const afterClockJump = uuidv7(1_780_000_000_000);
    expect(afterClockJump > before).toBe(true);
    expect(uuidv7Timestamp(afterClockJump).getTime()).toBeGreaterThanOrEqual(
      uuidv7Timestamp(before).getTime(),
    );
  });

  it('rejects non-UUID values', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
