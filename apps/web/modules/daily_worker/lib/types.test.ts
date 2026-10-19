import { describe, expect, it } from "vitest";
import { dayPay, daysInMonth, hoursLabel, judgeTimes, minutesToHm, otMinutes, shiftMonth } from "./types";

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
