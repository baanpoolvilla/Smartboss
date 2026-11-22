import { describe, expect, it } from "vitest";
import { advanceRound, canAdvance, legacyAdvanceRules, parseAdvanceRules } from "./advance-rules";

const cal = { monthStartDay: 1, weekStart: 1 };

describe("รอบเพดานเบิกล่วงหน้า", () => {
  it("ครึ่งเดือนตามปฏิทิน: 1–15 / 16–สิ้นเดือน", () => {
    expect(advanceRound("2026-11-15", "half", cal)).toMatchObject({ from: "2026-11-01", to: "2026-11-15", label: "รอบ 1–15 พ.ย. 2569" });
    expect(advanceRound("2026-11-16", "half", cal)).toMatchObject({ from: "2026-11-16", to: "2026-11-30" });
    expect(advanceRound("2027-02-20", "half", cal).to).toBe("2027-02-28");
  });
  it("ต่อเดือน = แบบเดิม", () => {
    expect(advanceRound("2026-11-20", "month", cal)).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
  });
  it("รอบเดือนเริ่มวันที่ 26 = 26 ถึง 25 เดือนถัดไป (ข้ามปีได้)", () => {
    expect(advanceRound("2026-11-22", "month", { monthStartDay: 26, weekStart: 1 })).toMatchObject({ from: "2026-10-26", to: "2026-11-25", label: "รอบ 26 ต.ค.–25 พ.ย. 2569" });
    expect(advanceRound("2026-12-28", "month", { monthStartDay: 26, weekStart: 1 })).toMatchObject({ from: "2026-12-26", to: "2027-01-25" });
    expect(advanceRound("2026-11-22", "half", { monthStartDay: 26, weekStart: 1 })).toMatchObject({ from: "2026-11-10", to: "2026-11-25" });
  });
  it("ต่อสัปดาห์ เริ่มวันจันทร์ / วันอาทิตย์", () => {
    // 22 พ.ย. 2026 = วันอาทิตย์
    expect(advanceRound("2026-11-22", "week", { monthStartDay: 1, weekStart: 1 })).toMatchObject({ from: "2026-11-16", to: "2026-11-22" });
    expect(advanceRound("2026-11-22", "week", { monthStartDay: 1, weekStart: 0 })).toMatchObject({ from: "2026-11-22", to: "2026-11-28" });
    expect(advanceRound("2026-12-30", "week", { monthStartDay: 1, weekStart: 1 }).label).toBe("รอบ 28 ธ.ค. 2569–3 ม.ค. 2570");
  });
});

describe("อ่านกติกา", () => {
  const ok = { who: "worker", monthStartDay: 1, weekStart: 1, worker: { mode: "baht", value: 1500, period: "half", maxCount: 1 }, staff: { mode: "none", value: 0, period: "month", maxCount: null } };
  it("ครบ = ผ่าน", () => {
    expect(parseAdvanceRules(ok)).toMatchObject({ who: "worker", worker: { value: 1500, maxCount: 1 } });
  });
  it("เพดาน 0 / จำนวนครั้ง 0 / วันเริ่ม 31 = ไม่ผ่าน", () => {
    expect(parseAdvanceRules({ ...ok, worker: { ...ok.worker, value: 0 } })).toBeNull();
    expect(parseAdvanceRules({ ...ok, worker: { ...ok.worker, maxCount: 0 } })).toBeNull();
    expect(parseAdvanceRules({ ...ok, monthStartDay: 31 })).toBeNull();
    expect(parseAdvanceRules(null)).toBeNull();
  });
  it("ไม่เคยตั้ง = แปลงจากเพดานเดิม เหมือนเดิมทุกคน", () => {
    const r = legacyAdvanceRules("baht", 3000);
    expect(r).toMatchObject({ who: "all", worker: { mode: "baht", value: 3000, period: "month", maxCount: null }, staff: { value: 3000 } });
    expect(canAdvance(r, "staff")).toBe(true);
    expect(canAdvance(legacyAdvanceRules("baht", 1500, "half", true), "staff")).toBe(false);
  });
});
