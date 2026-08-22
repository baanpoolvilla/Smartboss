import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupByDueDate,
  isoOf,
  monthGrid,
  pmStatusOf,
  shiftMonth,
  thaiMonthLabel,
} from "../pm-calendar";

test("ตารางเดือนเต็มสัปดาห์เสมอ และเริ่มวันอาทิตย์", () => {
  // ส.ค. 2026 เริ่มวันเสาร์ ⇒ ต้องมีช่องเดือนก่อนหน้านำมา 6 ช่อง
  const cells = monthGrid({ year: 2026, month: 7 });
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0]!.iso, "2026-07-26");
  assert.equal(cells[6]!.iso, "2026-08-01");
  assert.equal(cells.filter((c) => c.inMonth).length, 31);
});

test("เดือนกุมภาพันธ์ปีอธิกสุรทินได้ 29 วัน", () => {
  const cells = monthGrid({ year: 2028, month: 1 });
  assert.equal(cells.filter((c) => c.inMonth).length, 29);
});

test("ข้ามปีทั้งสองทางไม่หลุด", () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), {
    year: 2027,
    month: 0,
  });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), {
    year: 2025,
    month: 11,
  });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -13), {
    year: 2024,
    month: 11,
  });
});

test("หัวปฏิทินเป็น พ.ศ. ไม่ใช่ ค.ศ.", () => {
  assert.equal(thaiMonthLabel({ year: 2026, month: 7 }), "สิงหาคม 2569");
});

test("isoOf เติมศูนย์หน้าเลขหลักเดียว — ไม่งั้นคีย์ไม่ตรงกับ nextDueInput", () => {
  assert.equal(isoOf(2026, 0, 5), "2026-01-05");
  assert.equal(isoOf(2026, 11, 31), "2026-12-31");
});

const row = (over: Partial<Parameters<typeof pmStatusOf>[0]> = {}) => ({
  awaitingSchedule: false,
  hasPendingWorkOrder: false,
  daysUntilDue: 30,
  ...over,
});

test("รอนัดวันชนะทุกสถานะ แม้วันเก่าจะเลยกำหนดไปแล้ว", () => {
  assert.equal(
    pmStatusOf(row({ awaitingSchedule: true, daysUntilDue: -90 })),
    "awaitingSchedule"
  );
});

test("มีใบงานค้างอยู่ ต้องไม่ขึ้นแดงว่าเกินกำหนด", () => {
  assert.equal(
    pmStatusOf(row({ hasPendingWorkOrder: true, daysUntilDue: -3 })),
    "hasWorkOrder"
  );
});

test("เส้นแบ่งใกล้ถึงกำหนดคือ 7 วัน", () => {
  assert.equal(pmStatusOf(row({ daysUntilDue: 0 })), "dueSoon");
  assert.equal(pmStatusOf(row({ daysUntilDue: 7 })), "dueSoon");
  assert.equal(pmStatusOf(row({ daysUntilDue: 8 })), "onTrack");
  assert.equal(pmStatusOf(row({ daysUntilDue: -1 })), "overdue");
});

test("แผนที่รอนัดวันต้องไม่ถูกวางลงช่องวันบนปฏิทิน", () => {
  const map = groupByDueDate([
    { nextDueInput: "2026-08-21", awaitingSchedule: false, id: "a" },
    { nextDueInput: "2026-08-21", awaitingSchedule: true, id: "b" },
    { nextDueInput: "2026-08-22", awaitingSchedule: false, id: "c" },
  ]);
  assert.deepEqual(map.get("2026-08-21")!.map((r) => r.id), ["a"]);
  assert.deepEqual(map.get("2026-08-22")!.map((r) => r.id), ["c"]);
});
