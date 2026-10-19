import { describe, expect, it } from "vitest";
import { dayPay, daysInMonth, hoursLabel, judgeDay, judgeTimes, minutesToHm, otMinutes, shiftMonth } from "./types";

describe("daily worker helpers", () => {
  it("OT hours come from the start–end the supervisor typed, crossing midnight too", () => {
    expect(otMinutes("17:00", "19:00")).toBe(120);
    expect(otMinutes("17:00", "18:30")).toBe(90);
    expect(otMinutes("22:00", "02:00")).toBe(240);
    expect(hoursLabel(120)).toBe("2 ชม.");
    expect(hoursLabel(90)).toBe("1.5 ชม.");
  });
  it("months and shift times", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-10")).toBe(31);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(minutesToHm(480)).toBe("08:00");
    expect(minutesToHm(1440 + 360)).toBe("06:00");
  });
});

describe("worker pay rules (19/10/2569)", () => {
  // กะ 08:00–17:00 พักเที่ยง 12–13 = 480 นาที
  const S = 8 * 60, E = 17 * 60;
  it("on time, full day", () => {
    expect(judgeTimes(S, E, 7 * 60 + 55, 17 * 60 + 5)).toMatchObject({ lateMin: 0, earlyMin: 0, workedMin: 480, scheduledMin: 480 });
  });
  it("late 12 minutes → deduct 12 minutes of pay", () => {
    const t = judgeTimes(S, E, 8 * 60 + 12, E);
    expect(t.lateMin).toBe(12);
    expect(dayPay(400, t.lateMin + t.earlyMin, 0, 150)).toEqual({ wage: 400, deduct: 10, ot: 0, total: 390 });
  });
  it("lunch hour isn't counted as late or early", () => {
    expect(judgeTimes(S, E, 13 * 60, E).lateMin).toBe(240); // เข้าบ่ายโมง = ขาดช่วงเช้า 4 ชม.
    expect(judgeTimes(S, E, S, 12 * 60 + 30).earlyMin).toBe(240); // ออกระหว่างพัก = ขาดช่วงบ่าย 4 ชม.
    expect(judgeTimes(S, E, S, 16 * 60).earlyMin).toBe(60);
  });
  it("OT day ignores the scan-out", () => {
    expect(judgeTimes(S, E, S, 15 * 60, true).earlyMin).toBe(0);
  });
  it("OT = hours × (wage ÷ 8) × %", () => {
    expect(dayPay(400, 0, 120, 150).ot).toBe(150); // 2 ชม. × 50 × 1.5
    expect(dayPay(400, 0, 90, 200).ot).toBe(150); // 1.5 ชม. × 50 × 2
  });
  it("deduction never exceeds the day's wage", () => {
    expect(dayPay(400, 600, 0, 150).deduct).toBe(400);
  });
});

describe("judgeDay — one day of one worker (ค่าแรง 400 · กะ 08:00–17:00 · OT 150%)", () => {
  const base = { date: "2026-10-16", today: "2026-10-19", shiftStart: 480, shiftEnd: 1020, otMinutes: null, legacyOverride: false, wage: 400, otPercent: 150 };
  const day = (x: Partial<typeof base> & { inAt: string; outAt: string | null }) => judgeDay({ ...base, ...x });

  it("ตรงเวลา เต็มวัน = 400", () => {
    expect(day({ inAt: "08:00", outAt: "17:00" })).toMatchObject({ s: "m", lateMin: 0, earlyMin: 0, workedMin: 480, pay: { total: 400 } });
  });
  it("08:01 = สาย 1 นาที หัก 0.83", () => {
    expect(day({ inAt: "08:01", outAt: "17:00" })).toMatchObject({ s: "s", lateMin: 1, pay: { deduct: 0.83, total: 399.17 } });
  });
  it("สาย 30 + กลับก่อน 30 = หัก 60 นาที = 50 บาท", () => {
    expect(day({ inAt: "08:30", outAt: "16:30" })).toMatchObject({ s: "s", lateMin: 30, earlyMin: 30, pay: { deduct: 50, total: 350 } });
  });
  it("เข้า 13:00 (หลังพักเที่ยง) = สาย 4 ชม. ได้ครึ่งวัน", () => {
    expect(day({ inAt: "13:00", outAt: "17:00" })).toMatchObject({ s: "s", lateMin: 240, workedMin: 240, pay: { total: 200 } });
  });
  it("ไม่ลงออก วันที่ผ่านไปแล้ว = ขาด ไม่ได้เงิน", () => {
    expect(day({ inAt: "07:55", outAt: null })).toMatchObject({ s: "x", pay: null });
  });
  it("วันนี้ยังไม่ลงออก = บอกสายได้ แต่ยังไม่คิดเงิน", () => {
    expect(day({ date: "2026-10-19", inAt: "08:12", outAt: null })).toMatchObject({ s: "s", lateMin: 12, pay: null });
  });
  it("สแกนซ้ำตอนเช้า (07:58 / 07:59) = ไม่ได้ทำงานในกะเลย = ขาด", () => {
    expect(day({ inAt: "07:58", outAt: "07:59" })).toMatchObject({ s: "x", pay: null });
  });
  it("วัน OT 17–19 ไม่ลงออก = ไม่ขาด ได้ 400 + OT 150", () => {
    expect(day({ inAt: "08:00", outAt: null, otMinutes: 120 })).toMatchObject({ s: "m", pay: { ot: 150, total: 550 } });
  });
  it("วัน OT ยังหักสายตามปกติ", () => {
    expect(day({ inAt: "08:12", outAt: null, otMinutes: 120 })).toMatchObject({ s: "s", pay: { deduct: 10, ot: 150, total: 540 } });
  });
  it("\"แก้เป็นมา\" แบบเดิม = ไม่หักสาย", () => {
    expect(day({ inAt: "08:20", outAt: "17:00", legacyOverride: true })).toMatchObject({ s: "m", pay: { total: 400 } });
  });
  it("ยังไม่ตั้งค่าแรง = ตัดสินสายได้ แต่ไม่มียอดเงิน (ไม่ใช่ 0 บาท)", () => {
    expect(day({ inAt: "08:12", outAt: "17:00", wage: null })).toMatchObject({ s: "s", lateMin: 12, pay: null });
  });
  it("ไม่มีกะ = นับมา ไม่คิดเงิน", () => {
    expect(day({ inAt: "08:12", outAt: "17:00", shiftStart: null, shiftEnd: null })).toMatchObject({ s: "m", pay: null });
  });
  it("กะ 09:00–18:00 ใช้กะของวันนั้น: เข้า 08:50 = ไม่สาย", () => {
    expect(day({ inAt: "08:50", outAt: "18:00", shiftStart: 540, shiftEnd: 1080 })).toMatchObject({ s: "m", lateMin: 0, pay: { total: 400 } });
  });
});
