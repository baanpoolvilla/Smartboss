import { describe, expect, it } from "vitest";
import {
  commissionGradeOrder,
  defaultGradeWeights,
  parseBahtToSatang,
  parseGradeWeight,
  resolveGradeWeights,
  splitCommissionPool,
  type CommissionMember,
} from "./commission";

const member = (userId: string, grade: string): CommissionMember => ({
  userId,
  name: userId,
  email: `${userId}@example.com`,
  grade,
  score: 0,
});

describe("ตัวคูณตามเกรด", () => {
  it("ค่าตั้งต้นไล่ลงตามอันดับ และต่ำกว่าทุกเกณฑ์ได้ 0", () => {
    expect(defaultGradeWeights(["A", "B", "C", "D"])).toEqual({ A: 1, B: 0.75, C: 0.5, D: 0.25, F: 0 });
  });

  it("ค่าที่บริษัทตั้งทับเฉพาะเกรดที่ตั้ง — ค่าผิดขอบเขตใช้ค่าตั้งต้น", () => {
    expect(resolveGradeWeights(["A", "B"], { A: 2, B: -1, F: 0.1 })).toEqual({ A: 2, B: 0.5, F: 0.1 });
  });

  it("ไม่ต่อ F ซ้ำถ้าเกณฑ์ตั้งชื่อ F ไว้เอง", () => {
    expect(commissionGradeOrder(["A", "F"])).toEqual(["A", "F"]);
  });
});

describe("แบ่ง Pool", () => {
  it("แบ่งตามสัดส่วนตัวคูณ — เกรดเดียวกันได้เท่ากัน", () => {
    const result = splitCommissionPool(
      10_000_000, // 100,000 บาท
      [member("a1", "A"), member("a2", "A"), member("b1", "B"), member("b2", "B"), member("b3", "B"), member("f", "F")],
      { A: 1, B: 0.8, F: 0 },
    );
    const by = Object.fromEntries(result.shares.map((s) => [s.userId, s.amountSatang]));
    // หน่วยรวม 2 + 2.4 = 4.4 → หน่วยละ 22,727.27…
    expect(result.totalUnits).toBeCloseTo(4.4);
    expect(Math.abs(by.a1! - by.a2!)).toBeLessThanOrEqual(1);
    expect(by.a1).toBeGreaterThan(by.b1!);
    expect(by.f).toBe(0);
    expect(result.shares.reduce((s, x) => s + x.amountSatang, 0)).toBe(10_000_000);
  });

  it("เศษสตางค์ถูกแจกจนยอดรวมเท่า Pool พอดี", () => {
    const result = splitCommissionPool(100, [member("x", "A"), member("y", "A"), member("z", "A")], { A: 1 });
    expect(result.shares.map((s) => s.amountSatang).sort()).toEqual([33, 33, 34]);
  });

  it("ทุกคนตัวคูณ 0 — ไม่มีใครได้ และบอกยอดที่แจกไม่ออก", () => {
    const result = splitCommissionPool(50_000, [member("x", "F")], { F: 0 });
    expect(result.shares[0]!.amountSatang).toBe(0);
    expect(result.perUnitSatang).toBeNull();
    expect(result.undistributedSatang).toBe(50_000);
  });

  it("ผลเหมือนเดิมทุกครั้งแม้ลำดับรายชื่อต่างกัน", () => {
    const people = [member("m1", "A"), member("m2", "B"), member("m3", "A")];
    const w = { A: 1, B: 0.33 };
    const one = splitCommissionPool(100_001, people, w);
    const two = splitCommissionPool(100_001, [...people].reverse(), w);
    const map = (r: typeof one) => Object.fromEntries(r.shares.map((s) => [s.userId, s.amountSatang]));
    expect(map(one)).toEqual(map(two));
  });
});

describe("แปลงค่าจากช่องกรอก", () => {
  it("รับจุลภาคและทศนิยม 2 ตำแหน่ง", () => {
    expect(parseBahtToSatang("12,345.67")).toBe(1_234_567);
    expect(parseBahtToSatang("0.1")).toBe(10);
    expect(parseBahtToSatang("1.234")).toBeNull();
    expect(parseBahtToSatang("-5")).toBeNull();
    expect(parseBahtToSatang("100000000")).toBeNull();
  });

  it("ตัวคูณ 0..100 ทศนิยมไม่เกิน 2 ตำแหน่ง", () => {
    expect(parseGradeWeight("0.75")).toBe(0.75);
    expect(parseGradeWeight("101")).toBeNull();
    expect(parseGradeWeight("abc")).toBeNull();
  });
});
