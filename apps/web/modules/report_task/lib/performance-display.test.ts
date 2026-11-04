import { describe, expect, it } from "vitest";
import { categoryLabel, displayCategory, MANUAL_BONUS_ROW, supersededLateReportIds, withoutSupersededLateReports } from "@/lib/performance";

describe("displayCategory — สติกเกอร์ของหัวหน้าแยก + / −", () => {
  it("ติดลบ = หักคะแนนโดยหัวหน้า", () => {
    expect(categoryLabel(displayCategory({ category: "task_manual_dock", points: -1, refType: "task_reaction" }))).toBe("หักคะแนนโดยหัวหน้า");
  });
  it("บวก = หัวหน้าให้คะแนนเพิ่ม", () => {
    expect(displayCategory({ category: "task_manual_dock", points: 1, refType: "task_reaction" })).toBe(MANUAL_BONUS_ROW);
    expect(categoryLabel(MANUAL_BONUS_ROW)).toBe("หัวหน้าให้คะแนนเพิ่ม");
  });
  it("ยกเลิกสติกเกอร์ + (−1) อยู่แถวเดียวกับของเดิม", () => {
    expect(displayCategory({ category: "task_manual_dock", points: -1, refType: "task_reaction_undo" })).toBe(MANUAL_BONUS_ROW);
  });
  it("หมวดอื่นไม่เปลี่ยน", () => {
    expect(displayCategory({ category: "task_late", points: 3, refType: "task_undo" })).toBe("task_late");
  });
});

describe("สาย −1 ที่กลายเป็นไม่ส่ง −2 — ไม่แสดงเป็นการคืนคะแนน", () => {
  const ev = (id: string, category: string, refType: string, refId = "2026-11-03:t:r:u") => ({ id, userId: "u", category, refType, refId });

  it("สาย + คืนสาย + ไม่ส่ง = เหลือแถวไม่ส่งแถวเดียว", () => {
    const events = [ev("late", "report_late", "report_round"), ev("undo", "report_late", "report_round_undo"), ev("missed", "report_missed", "report_round")];
    expect(withoutSupersededLateReports(events).map((e) => e.id)).toEqual(["missed"]);
  });
  it("คืนสายจริงจากคำร้อง (ไม่มีไม่ส่ง) ยังแสดงว่าคืนแล้ว", () => {
    const events = [ev("late", "report_late", "report_round"), ev("undo", "report_late", "report_round_undo")];
    expect(supersededLateReportIds(events).size).toBe(0);
  });
  it("สายที่ยังหักอยู่ไม่ถูกซ่อน แม้รอบเดียวกันมีไม่ส่ง", () => {
    const events = [ev("late", "report_late", "report_round"), ev("missed", "report_missed", "report_round")];
    expect(supersededLateReportIds(events).size).toBe(0);
  });
  it("คนละรอบไม่ปนกัน", () => {
    const events = [ev("late", "report_late", "report_round"), ev("undo", "report_late", "report_round_undo"), ev("missed", "report_missed", "report_round", "2026-11-04:t:r:u")];
    expect(supersededLateReportIds(events).size).toBe(0);
  });
});
