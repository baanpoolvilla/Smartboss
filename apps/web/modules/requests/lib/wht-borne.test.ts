import { describe, expect, it } from "vitest";
import { advanceRoundOf, borneBreakdown } from "./types";
import { mustUseCompanyAccount } from "./company-accounts";

describe("จ่ายร้านไปเต็มแล้ว บริษัทออกภาษีให้", () => {
  it("ภาษีคิดแบบบวกเพิ่ม 3/97 — เงินได้ × 3% = ภาษีพอดี", () => {
    const g = borneBreakdown(1500, 0, 3);
    expect(g).toMatchObject({ paid: 1500, tax: 46.39, income: 1546.39, cost: 1546.39 });
    expect(Math.round(g.income * 3) / 100).toBe(g.tax);
  });
  it("มี VAT: ร้านได้ค่าจ้าง + VAT เต็ม · ภาษีคิดจากค่าจ้างก่อน VAT", () => {
    expect(borneBreakdown(2000, 7, 3)).toMatchObject({ vat: 140, paid: 2140, tax: 61.86, income: 2061.86, cost: 2201.86 });
  });
  it("เก็บลงใบแบบเดิมได้: เงินได้ + VAT − ภาษี = ที่จ่ายร้านไป", () => {
    const g = borneBreakdown(2000, 7, 3);
    expect(Math.round((g.income + g.vat - g.tax) * 100) / 100).toBe(g.paid);
  });
  it("ไม่หัก = ไม่มีภาษี", () => {
    expect(borneBreakdown(800, 0, 0).tax).toBe(0);
  });
  it("ใบที่บริษัทออกภาษีให้ ไม่บังคับโอนจากบัญชีบริษัท (เป็นการคืนเงินคนสำรองจ่าย)", () => {
    expect(mustUseCompanyAccount({ whtCompanyOnly: true }, 46.39, true)).toBe(false);
    expect(mustUseCompanyAccount({ whtCompanyOnly: true }, 60, false)).toBe(true);
  });
});

describe("เพดานเบิกล่วงหน้าต่อรอบ", () => {
  it("ครึ่งเดือน: 1–15 และ 16–สิ้นเดือน", () => {
    expect(advanceRoundOf("2026-11-15", "half")).toMatchObject({ from: "2026-11-01", to: "2026-11-15", label: "รอบ 1–15 พ.ย. 2569" });
    expect(advanceRoundOf("2026-11-16", "half")).toMatchObject({ from: "2026-11-16", to: "2026-11-30" });
    expect(advanceRoundOf("2027-02-20", "half").to).toBe("2027-02-28");
  });
  it("ต่อเดือน = แบบเดิม", () => {
    expect(advanceRoundOf("2026-11-20", "month")).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
  });
});
