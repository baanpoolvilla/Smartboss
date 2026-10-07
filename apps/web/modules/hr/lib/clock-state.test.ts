import { describe, expect, it } from "vitest";
import { clockState } from "./clock-state";

const ev = (intent: string, hhmm: string) => ({ intent, capturedAt: `2026-10-07T${hhmm}:00+07:00` });

describe("clockState", () => {
  it("ยังไม่ลงอะไร = ไม่อยู่ในงาน", () => {
    expect(clockState([])).toEqual({ open: false, firstIn: null, lastOut: null, openedBy: null });
  });

  it("กดเข้าในแอป = อยู่ในงาน ปุ่มถัดไปคือออก", () => {
    const inn = ev("CLOCK_IN", "08:00");
    const s = clockState([inn]);
    expect(s.open).toBe(true);
    expect(s.firstIn).toBe(inn);
  });

  it("สแกนนิ้ว (AUTO) ครั้งแรก = เข้า ไม่ใช่ให้กดเข้าซ้ำ", () => {
    const scan = ev("AUTO", "07:55");
    const s = clockState([scan]);
    expect(s.open).toBe(true);
    expect(s.firstIn).toBe(scan);
  });

  it("สแกนนิ้วเข้า แล้วกดออกในแอป = ครบ", () => {
    const scan = ev("AUTO", "07:55");
    const out = ev("CLOCK_OUT", "17:30");
    const s = clockState([scan, out]);
    expect(s.open).toBe(false);
    expect(s.firstIn).toBe(scan);
    expect(s.lastOut).toBe(out);
  });

  it("เข้า-ออกหลายรอบ: เข้าครั้งแรก / ออกครั้งล่าสุด", () => {
    const a = ev("CLOCK_IN", "08:00");
    const b = ev("CLOCK_OUT", "12:00");
    const c = ev("CLOCK_IN", "13:00");
    const d = ev("CLOCK_OUT", "17:00");
    const s = clockState([a, b, c, d]);
    expect(s).toMatchObject({ open: false, firstIn: a, lastOut: d });
  });

  it("พักไม่เปลี่ยนสถานะ", () => {
    const s = clockState([ev("CLOCK_IN", "08:00"), ev("BREAK_START", "12:00"), ev("BREAK_END", "13:00")]);
    expect(s.open).toBe(true);
  });

  it("กะข้ามคืน: เข้าเมื่อวาน ยังไม่ออก ⇒ วันนี้ปุ่มคือออก", () => {
    const yesterday = { intent: "CLOCK_IN", capturedAt: "2026-10-06T22:00:00+07:00" };
    const s = clockState([], yesterday);
    expect(s.open).toBe(true);
    expect(s.firstIn).toBe(yesterday);
    const out = ev("CLOCK_OUT", "06:00");
    expect(clockState([out], yesterday)).toMatchObject({ open: false, lastOut: out });
  });

  it("openedBy = รายการที่เปิดช่วงล่าสุด (ใช้หากะค้างข้ามคืน)", () => {
    const night = ev("CLOCK_IN", "22:00");
    const s = clockState([ev("CLOCK_IN", "08:00"), ev("CLOCK_OUT", "17:00"), night]);
    expect(s.openedBy).toBe(night);
    expect(clockState([ev("CLOCK_IN", "08:00"), ev("CLOCK_OUT", "17:00")]).openedBy).toBeNull();
  });
});
