import { describe, expect, it } from "vitest";
import { deriveCompletedAssigneeIds, isTaskFullyDone } from "@/modules/report_task/lib/task-completion";
import { canToggleOwnChecklistItem } from "@/modules/report_task/lib/permissions";
import { taskSchema } from "@/modules/report_task/lib/db/task-schema";
import type { ChecklistItem } from "@/modules/report_task/types";

/** ข้อ "ช่วยกันทำ" ปนกับข้อรายคน (ผู้ใช้ 10/11/2569) */
const A = "a";
const B = "b";
const item = (id: string, done: boolean, extra: Partial<ChecklistItem>): ChecklistItem => ({ id, text: id, done, ...extra });

describe("ข้อช่วยกันทำในงานกลุ่มแบบแยกคน", () => {
  const list = (aDone: boolean, bDone: boolean, sharedDone: boolean) => [
    item("a1", aDone, { ownerId: A }),
    item("b1", bDone, { ownerId: B }),
    item("s1", sharedDone, { shared: true }),
  ];

  it("ข้อของตัวเองครบ แต่ข้อช่วยกันทำยังไม่เสร็จ → ยังไม่ครบ", () => {
    expect(deriveCompletedAssigneeIds([A, B], list(true, true, false))).toEqual([]);
    expect(isTaskFullyDone([A, B], list(true, true, false))).toBe(false);
  });

  it("ข้อช่วยกันทำเสร็จ + ข้อของใครครบ → คนนั้นครบ", () => {
    expect(deriveCompletedAssigneeIds([A, B], list(true, false, true))).toEqual([A]);
    expect(isTaskFullyDone([A, B], list(true, true, true))).toBe(true);
  });

  it("คนใดคนหนึ่ง: A ครบ + ข้อช่วยกันทำเสร็จ → ปิดงานได้", () => {
    expect(isTaskFullyDone([A, B], list(true, false, true), "any")).toBe(true);
    expect(isTaskFullyDone([A, B], list(true, false, false), "any")).toBe(false);
  });

  it("คนที่ไม่มีข้อของตัวเอง ครบเมื่อข้อช่วยกันทำเสร็จ (ไม่ต้องติ๊กเอง)", () => {
    const l = [item("a1", true, { ownerId: A }), item("s1", true, { shared: true })];
    expect(deriveCompletedAssigneeIds([A, B], l)).toEqual([A, B]);
  });

  it("ไม่มีข้อช่วยกันทำ = เหมือนเดิมทุกอย่าง (คนไม่มีข้อ ติ๊กเอง)", () => {
    const l = [item("a1", true, { ownerId: A })];
    expect(deriveCompletedAssigneeIds([A, B], l)).toEqual([A]);
    expect(deriveCompletedAssigneeIds([A, B], l, [B])).toEqual([A, B]);
  });

  it("ใครในงานก็ติ๊กข้อช่วยกันทำได้ · คนนอกงานไม่ได้ · ข้อของคนอื่นยังติ๊กแทนไม่ได้", () => {
    const task = { assigneeIds: [A, B] };
    expect(canToggleOwnChecklistItem(item("s1", false, { shared: true }), B, task)).toBe(true);
    expect(canToggleOwnChecklistItem(item("s1", false, { shared: true }), "out", task)).toBe(false);
    expect(canToggleOwnChecklistItem(item("a1", false, { ownerId: A }), B, task)).toBe(false);
  });

  it("บันทึกแล้วยังเป็นข้อช่วยกันทำ (zod ไม่ตัดทิ้ง)", () => {
    const parsed = taskSchema.shape.checklist.parse([item("s1", false, { shared: true })]);
    expect(parsed[0]!.shared).toBe(true);
  });
});
