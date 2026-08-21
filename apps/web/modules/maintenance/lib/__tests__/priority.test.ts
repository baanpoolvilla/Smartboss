import { test } from "node:test";
import assert from "node:assert/strict";

import { groupByPriority, AUTO_GROUP_KEY } from "../priority";

const wo = (id: string, priority: string, autoCreated = false) => ({
  id,
  priority,
  autoCreated,
});

test("เรียงกลุ่มจากด่วนสุดไปน้อยสุดเสมอ ไม่ว่าข้อมูลจะเข้ามาสลับกันแค่ไหน", () => {
  const groups = groupByPriority([
    wo("a", "low"),
    wo("b", "urgent"),
    wo("c", "medium"),
    wo("d", "high"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["urgent", "high", "medium", "low"]
  );
});

test("กลุ่มที่ไม่มีงานถูกตัดทิ้ง ไม่แสดงหัวข้อเปล่า", () => {
  const groups = groupByPriority([wo("a", "urgent"), wo("b", "urgent")]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["urgent"]
  );
  assert.equal(groups[0]!.orders.length, 2);
});

test("งานอัตโนมัติแยกกลุ่มท้ายสุด ไม่ปนกับ 'ปานกลาง' แม้ priority จะเป็น medium", () => {
  const groups = groupByPriority([
    wo("auto1", "medium", true),
    wo("manual", "medium"),
    wo("auto2", "medium", true),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["medium", AUTO_GROUP_KEY]
  );
  assert.deepEqual(
    groups[0]!.orders.map((o) => o.id),
    ["manual"]
  );
  assert.deepEqual(
    groups[1]!.orders.map((o) => o.id),
    ["auto1", "auto2"]
  );
});

test("priority ที่ไม่รู้จักต้องไม่หายไปเงียบ ๆ — ตกไปกลุ่มท้ายสุดของงานปกติ", () => {
  const groups = groupByPriority([wo("x", "critical"), wo("y", "urgent")]);
  const all = groups.flatMap((g) => g.orders.map((o) => o.id));
  assert.deepEqual(all.sort(), ["x", "y"]);
  assert.equal(groups.at(-1)!.key, "low");
});

test("ลำดับภายในกลุ่มคงตามที่รับเข้ามา (ใหม่ก่อนเก่า)", () => {
  const groups = groupByPriority([
    wo("new", "urgent"),
    wo("mid", "urgent"),
    wo("old", "urgent"),
  ]);
  assert.deepEqual(
    groups[0]!.orders.map((o) => o.id),
    ["new", "mid", "old"]
  );
});
