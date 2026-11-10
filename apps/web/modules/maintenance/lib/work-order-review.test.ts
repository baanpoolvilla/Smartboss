import { describe, expect, it } from "vitest";
import { canReviewOrder, isAwaitingReview, needsReview, validRedoDate } from "./work-order-review";

const manual = { autoCreated: false, pmRoundDate: null, isPrivate: false, createdBy: "opener" };

describe("ตรวจใบแจ้งซ่อม (10/11/2569)", () => {
  it("ใบที่คนเปิด ต้องตรวจ · รวมใบที่กดสร้างเองจากแผน PM (ไม่มีวันรอบ)", () => {
    expect(needsReview(manual, true)).toBe(true);
  });
  it("ใบ PM อัตโนมัติ / ใบรอบ PM (ทำล่วงหน้า, CEO รวบ) / ใบส่วนตัว / ไม่มีคนเปิด / ปิดสวิตช์ → ไม่ต้องตรวจ", () => {
    expect(needsReview({ ...manual, autoCreated: true }, true)).toBe(false);
    expect(needsReview({ ...manual, pmRoundDate: new Date("2026-11-17T00:00:00Z") }, true)).toBe(false);
    expect(needsReview({ ...manual, isPrivate: true }, true)).toBe(false);
    expect(needsReview({ ...manual, createdBy: null }, true)).toBe(false);
    expect(needsReview(manual, false)).toBe(false);
  });
  it("คนตรวจ = คนเปิดใบ (เปิดให้ตัวเองก็ตรวจเอง) · บอสตรวจได้ทุกใบ · คนอื่นไม่ได้", () => {
    expect(canReviewOrder(manual, "opener", false)).toBe(true);
    expect(canReviewOrder(manual, "boss", true)).toBe(true);
    expect(canReviewOrder(manual, "worker", false)).toBe(false);
  });
  it("รอตรวจ = เสร็จแล้ว + pending", () => {
    expect(isAwaitingReview({ status: "completed", reviewState: "pending" })).toBe(true);
    expect(isAwaitingReview({ status: "completed", reviewState: "passed" })).toBe(false);
    expect(isAwaitingReview({ status: "in_progress", reviewState: "failed" })).toBe(false);
    expect(isAwaitingReview({ status: "completed", reviewState: "none" })).toBe(false);
  });
  it("กำหนดส่งใหม่ตอนไม่ผ่าน: วันนี้หรือหลังจากนี้เท่านั้น", () => {
    expect(validRedoDate("2026-11-10", "2026-11-10")).toBe(true);
    expect(validRedoDate("2026-11-14", "2026-11-10")).toBe(true);
    expect(validRedoDate("2026-11-09", "2026-11-10")).toBe(false);
    expect(validRedoDate("14/11/2026", "2026-11-10")).toBe(false);
  });
});
