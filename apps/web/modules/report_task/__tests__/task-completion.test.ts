import test from "node:test";
import assert from "node:assert/strict";
import { deriveCompletedAssigneeIds, isDoneByRule, isTaskFullyDone } from "../lib/task-completion";
import type { ChecklistItem } from "../types";

const item = (ownerId: string, done: boolean): ChecklistItem => ({ id: `${ownerId}-${done}-${Math.random()}`, text: "x", done, ownerId }) as ChecklistItem;

test("งานที่ไม่มีเช็คลิสต์เลย เลื่อนเป็นเสร็จสิ้นเองได้ (เช็คลิสต์ไม่บังคับ)", () => {
  assert.equal(isTaskFullyDone(["u1"], []), true);
  assert.equal(isTaskFullyDone(["u1", "u2"], []), true);
});

test("ไม่มีผู้รับผิดชอบ = ยังไม่เสร็จ แม้ไม่มีเช็คลิสต์", () => {
  assert.equal(isTaskFullyDone([], []), false);
});

test("มีเช็คลิสต์ = ต้องติ๊กครบของทุกคนตามเดิม", () => {
  assert.equal(isTaskFullyDone(["u1"], [item("u1", true), item("u1", false)]), false);
  assert.equal(isTaskFullyDone(["u1"], [item("u1", true), item("u1", true)]), true);
  assert.equal(isTaskFullyDone(["u1", "u2"], [item("u1", true)]), false);
});

test("การเสร็จอัตโนมัติจากการติ๊ก ยังนับเฉพาะคนที่มีรายการของตัวเองและติ๊กครบ", () => {
  assert.deepEqual(deriveCompletedAssigneeIds(["u1", "u2"], [item("u1", true)]), ["u1"]);
  assert.deepEqual(deriveCompletedAssigneeIds(["u1"], []), []);
});

test("กติกาปิดงาน: all = ครบทุกคน, any = คนใดคนหนึ่งก็พอ (ค่าเริ่มต้น all)", () => {
  assert.equal(isDoneByRule(["u1", "u2"], ["u1"]), false);
  assert.equal(isDoneByRule(["u1", "u2"], ["u1"], "all"), false);
  assert.equal(isDoneByRule(["u1", "u2"], ["u1", "u2"], "all"), true);
  assert.equal(isDoneByRule(["u1", "u2"], ["u1"], "any"), true);
  assert.equal(isDoneByRule(["u1", "u2"], [], "any"), false);
  assert.equal(isDoneByRule([], ["u1"], "any"), false);
});

test("isTaskFullyDone ตามกติกา any: มีคนเดียวติ๊กครบก็ปิดได้ / all: ยังไม่ได้", () => {
  const checklist = [item("u1", true), item("u2", false)];
  assert.equal(isTaskFullyDone(["u1", "u2"], checklist, "any"), true);
  assert.equal(isTaskFullyDone(["u1", "u2"], checklist, "all"), false);
  assert.equal(isTaskFullyDone(["u1", "u2"], checklist), false);
  assert.equal(isTaskFullyDone(["u1", "u2"], [item("u1", false), item("u2", false)], "any"), false);
});
