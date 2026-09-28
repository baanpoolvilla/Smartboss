import { test } from "node:test";
import assert from "node:assert/strict";

import { pmDockRevokeReason, workOrderDockRevokeReason } from "../dock-validity";

const st = { workOrderGraceDays: 0, pmGraceDays: 7, scoringStartDate: null as Date | null };
const due = new Date("2026-09-10T23:59:59.999+07:00");
const docked = { userId: "sujita", occurredAt: new Date("2026-09-11T02:00:00Z") };
const openWo = { status: "open", dueDate: due, completedAt: null, assignedTo: "sujita", caretakerId: null };

test("ใบงานเกินกำหนดที่ยังค้างกับคนเดิม — หักถูก ไม่คืน", () => {
  assert.equal(workOrderDockRevokeReason(docked, openWo, st), null);
});

test("ปิดงานช้ากว่ากำหนด — ยังหักถูก ไม่คืน", () => {
  const wo = { ...openWo, status: "completed", completedAt: new Date("2026-09-15T03:00:00Z") };
  assert.equal(workOrderDockRevokeReason(docked, wo, st), null);
});

test("ยกเลิก/ลบใบงาน — คืน", () => {
  assert.equal(workOrderDockRevokeReason(docked, { ...openWo, status: "cancelled" }, st), "ใบงานถูกยกเลิก");
  assert.equal(workOrderDockRevokeReason(docked, undefined, st), "ใบงานถูกลบ");
});

test("เลื่อนกำหนดส่งไปหลังวันที่โดนหัก — คืน", () => {
  const wo = { ...openWo, dueDate: new Date("2026-09-20T23:59:59.999+07:00") };
  assert.equal(workOrderDockRevokeReason(docked, wo, st), "เลื่อนกำหนดส่งหลังโดนหัก");
});

test("ย้ายให้คนอื่นทั้งที่งานยังค้าง — คืนคนเดิม (cron หักคนใหม่แทน)", () => {
  assert.equal(workOrderDockRevokeReason(docked, { ...openWo, assignedTo: "somchai" }, st), "ย้ายผู้รับผิดชอบแล้ว");
});

test("ใบงานไม่มีผู้รับ ตกที่ผู้ดูแลบ้าน — ยังหักผู้ดูแลบ้านตามกติกาเดิม", () => {
  const wo = { ...openWo, assignedTo: null, caretakerId: "sujita" };
  assert.equal(workOrderDockRevokeReason(docked, wo, st), null);
});

test("เลยกำหนดตั้งแต่ก่อนวันเริ่มนับคะแนน (งานค้างเก่า) — คืน", () => {
  const s = { ...st, scoringStartDate: new Date("2026-09-15T00:00:00+07:00") };
  const late = { ...docked, occurredAt: new Date("2026-09-16T02:00:00Z") };
  assert.equal(workOrderDockRevokeReason(late, openWo, s), "เลยกำหนดก่อนวันเริ่มนับคะแนน");
});

const pm = {
  id: "pm1",
  isActive: true,
  awaitingSchedule: false,
  nextDueDate: new Date("2026-09-01T00:00:00Z"),
  assignedTo: "sujita",
  caretakerId: null,
};
const pmDock = { userId: "sujita", occurredAt: new Date("2026-09-09T02:00:00Z"), refId: "pm1:2026-09-01" };

test("PM ค้างรอบกับคนเดิม — หักถูก ไม่คืน", () => {
  assert.equal(pmDockRevokeReason(pmDock, pm, [], new Map(), st), null);
});

test("PM ทำรอบนั้นแล้ว (รอบเลื่อนไป) — ยังหักถูก เพราะทำเกินระยะผ่อนผันไปแล้ว", () => {
  const moved = { ...pm, nextDueDate: new Date("2026-10-01T00:00:00Z") };
  assert.equal(pmDockRevokeReason(pmDock, moved, [], new Map(), st), null);
});

test("PM ถูกลบ/ปิดใช้งาน/รอนัดรอบใหม่ — คืน", () => {
  assert.equal(pmDockRevokeReason(pmDock, undefined, [], new Map(), st), "แผน PM ถูกลบ");
  assert.equal(pmDockRevokeReason(pmDock, { ...pm, isActive: false }, [], new Map(), st), "แผน PM ถูกปิดใช้งาน");
  assert.equal(pmDockRevokeReason(pmDock, { ...pm, awaitingSchedule: true }, [], new Map(), st), "PM รอนัดรอบใหม่");
});

test("ใบงานของ PM เดียวกันโดน 'ใบงานเกินกำหนด' คนเดียวกันแล้ว — คืน 'ไม่ทำตามรอบ' (ไม่หักซ้อน)", () => {
  const wo = {
    id: "wo1",
    createdAt: new Date("2026-08-28T00:00:00Z"),
    completedAt: null,
    pmScheduleId: null,
    pmScheduleIds: ["pm1"],
  };
  assert.equal(
    pmDockRevokeReason(pmDock, pm, [wo], new Map([["wo1", "sujita"]]), st),
    "ซ้อนกับใบงานเกินกำหนดของ PM เดียวกัน",
  );
  // ใบงานรอบก่อนที่ปิดไปแล้วก่อนรอบนี้ ไม่นับว่าซ้อน
  const old = { ...wo, completedAt: new Date("2026-08-15T00:00:00Z") };
  assert.equal(pmDockRevokeReason(pmDock, pm, [old], new Map([["wo1", "sujita"]]), st), null);
});
