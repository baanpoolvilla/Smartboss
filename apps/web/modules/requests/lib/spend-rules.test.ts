import { describe, expect, it } from "vitest";
import { amountsByProperty, cleanNoReceipt, clearingMatches, evaluateLimit, parseSpendLimits, weekStartOf, type SpendLimitRule } from "./spend-rules";

const rule: SpendLimitRule = { id: "lim-a", name: "ของใช้ในบ้านประจำ", kinds: ["cash_advance", "expense"], categories: ["วัสดุ / อุปกรณ์"], perRequest: 500, perWeek: 2000, userIds: ["u1"], active: true };
const ctx = (over: Partial<Parameters<typeof evaluateLimit>[1]> = {}) => ({
  kind: "cash_advance" as const,
  category: "วัสดุ / อุปกรณ์",
  amount: 320,
  beneficiaryUserId: "u1",
  usedThisWeek: () => 0,
  blockedBecause: null,
  ...over,
});

describe("วงเงินรายคน", () => {
  it("อยู่ในวงเงิน = ผ่านเอง", () => {
    const r = evaluateLimit([rule], ctx());
    expect(r.rule?.id).toBe("lim-a");
    expect(r.shown?.left).toBe(2000);
  });
  it("ไม่มีวงเงินของคนนี้ = ไม่ผ่านเอง ไม่แสดงอะไร (แบบเดิม)", () => {
    expect(evaluateLimit([rule], ctx({ beneficiaryUserId: "u2" }))).toEqual({ rule: null, shown: null, reason: null });
    expect(evaluateLimit([], ctx())).toEqual({ rule: null, shown: null, reason: null });
  });
  it("เกินครั้งละ = รอคนอนุมัติ", () => {
    const r = evaluateLimit([rule], ctx({ amount: 501 }));
    expect(r.rule).toBeNull();
    expect(r.reason).toContain("ครั้งละ");
  });
  it("เกินวงเงินสัปดาห์ = รอคนอนุมัติ · พอดีวงเงิน = ผ่าน", () => {
    expect(evaluateLimit([rule], ctx({ amount: 400, usedThisWeek: () => 1700 })).rule).toBeNull();
    expect(evaluateLimit([rule], ctx({ amount: 300, usedThisWeek: () => 1700 })).rule?.id).toBe("lim-a");
  });
  it("หมวดไม่อยู่ในวงเงิน / ไม่ได้เลือกหมวด = รอคนอนุมัติ", () => {
    expect(evaluateLimit([rule], ctx({ category: "อาหาร / เครื่องดื่ม" })).reason).toContain("ไม่อยู่ในวงเงิน");
    expect(evaluateLimit([rule], ctx({ category: null })).reason).toContain("เลือกหมวด");
  });
  it("ไม่กำหนดหมวด = ทุกหมวด", () => {
    expect(evaluateLimit([{ ...rule, categories: [] }], ctx({ category: null })).rule?.id).toBe("lim-a");
  });
  it("ต้องผ่าน CEO / ค้างเคลียร์ = ไม่ผ่านเองแม้อยู่ในวงเงิน", () => {
    const r = evaluateLimit([rule], ctx({ blockedBecause: "ใบนี้ต้องผ่าน CEO — ไม่ใช้วงเงิน" }));
    expect(r.rule).toBeNull();
    expect(r.reason).toContain("CEO");
  });
  it("ประเภทอื่น (OT/เบิกล่วงหน้า) ไม่ใช้วงเงิน · ปิดกฎ = ไม่ใช้", () => {
    expect(evaluateLimit([rule], ctx({ kind: "advance" })).rule).toBeNull();
    expect(evaluateLimit([{ ...rule, active: false }], ctx()).rule).toBeNull();
  });
  it("อ่านจากฐานข้อมูล: ตัดกฎเสีย · ต่อสัปดาห์ไม่น้อยกว่าครั้งละ", () => {
    const out = parseSpendLimits([rule, { ...rule, id: "x" }, { ...rule, id: "lim-b", perWeek: 100 }, { ...rule, id: "lim-c", kinds: ["ot"] }, { ...rule, id: "lim-d", categories: ["ไม่มีหมวดนี้"] }]);
    expect(out.map((r) => r.id)).toEqual(["lim-a", "lim-b", "lim-d"]);
    expect(out[1]!.perWeek).toBe(500);
    expect(out[2]!.categories).toEqual([]);
  });
  it("สัปดาห์เริ่มวันจันทร์", () => {
    expect(weekStartOf("2026-11-22")).toBe("2026-11-16"); // อาทิตย์
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16"); // จันทร์
    expect(weekStartOf("2026-11-18")).toBe("2026-11-16");
  });
});

describe("ใบรับรองแทนใบเสร็จ", () => {
  const base = { date: "2026-11-20", seller: "แผงผักป้าแดง", items: [{ item: "ผักบุ้ง", amount: 60 }, { item: "มะนาว", amount: 40 }], reason: "ร้านตลาด / แผงลอย ไม่มีบิล" };
  it("บริษัทไม่เปิด = ใช้ไม่ได้", () => {
    expect(cleanNoReceipt(base, { max: null, signedName: "สุจิตรา", today: "2026-11-22" })).toHaveProperty("error");
  });
  it("ถูกต้อง = รวมยอดให้ + ใส่ชื่อผู้รับรอง", () => {
    const r = cleanNoReceipt(base, { max: 500, signedName: "สุจิตรา", today: "2026-11-22", expectTotal: 100 });
    expect("value" in r && r.value.total).toBe(100);
    expect("value" in r && r.value.signedName).toBe("สุจิตรา");
  });
  it("เกินเพดาน / ยอดไม่ตรง / วันที่อนาคต / ไม่มีร้าน = ไม่ผ่าน", () => {
    expect(cleanNoReceipt(base, { max: 90, signedName: "x", today: "2026-11-22" })).toHaveProperty("error");
    expect(cleanNoReceipt(base, { max: 500, signedName: "x", today: "2026-11-22", expectTotal: 120 })).toHaveProperty("error");
    expect(cleanNoReceipt({ ...base, date: "2026-11-30" }, { max: 500, signedName: "x", today: "2026-11-22" })).toHaveProperty("error");
    expect(cleanNoReceipt({ ...base, seller: " " }, { max: 500, signedName: "x", today: "2026-11-22" })).toHaveProperty("error");
  });
});

describe("ปิดเคลียร์เองเมื่อยอดตรง", () => {
  it("ใบเสร็จอ่านได้ตรง + ทอนครบ = ตรง", () => {
    expect(clearingMatches({ paid: 320, spent: 285, returned: 35, receiptAmounts: [285], noReceiptTotal: null })).toBe(true);
  });
  it("ทอนไม่ครบ / ใบเสร็จอ่านไม่ได้ / ยอดอ่านต่างเกิน 1 บาท = ไม่ตรง (HR ตรวจ)", () => {
    expect(clearingMatches({ paid: 320, spent: 285, returned: 30, receiptAmounts: [285], noReceiptTotal: null })).toBe(false);
    expect(clearingMatches({ paid: 320, spent: 285, returned: 35, receiptAmounts: [null], noReceiptTotal: null })).toBe(false);
    expect(clearingMatches({ paid: 320, spent: 285, returned: 35, receiptAmounts: [280], noReceiptTotal: null })).toBe(false);
  });
  it("ใบรับรองแทนใบเสร็จยอดเท่าที่ใช้ = ตรง · ไม่ได้ใช้เลยคืนเต็ม = ตรง", () => {
    expect(clearingMatches({ paid: 200, spent: 150, returned: 50, receiptAmounts: [], noReceiptTotal: 150 })).toBe(true);
    expect(clearingMatches({ paid: 200, spent: 0, returned: 200, receiptAmounts: [], noReceiptTotal: null })).toBe(true);
  });
});

describe("แยกบ้านต่อรายการ", () => {
  it("รวมยอดต่อบ้าน รายการที่ไม่เลือกใช้บ้านของใบ", () => {
    const out = amountsByProperty(
      [{ item: "น้ำแข็ง", amount: 90, propertyId: "a3", propertyName: "A3" }, { item: "แก๊ส", amount: 420, propertyId: "c2", propertyName: "C2" }, { item: "ถุงขยะ", amount: 95 }],
      { id: "a3", name: "A3" },
    );
    expect(out).toEqual([{ id: "a3", name: "A3", amount: 185 }, { id: "c2", name: "C2", amount: 420 }]);
  });
});
