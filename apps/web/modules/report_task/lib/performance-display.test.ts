import { describe, expect, it } from "vitest";
import { categoryLabel, displayCategory, MANUAL_BONUS_ROW } from "@/lib/performance";

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
