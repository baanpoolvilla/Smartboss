import { test } from "node:test";
import assert from "node:assert/strict";

import { dueRounds, overdueGraceDays, pmUsesRounds, roundBeforeStart, roundDueAt, todayBkkDate } from "../pm-rounds";
import { workOrderDockRevokeReason } from "../dock-validity";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const monthly = { nextDueDate: d("2026-12-01"), anchorDate: d("2026-12-01"), frequency: "monthly", roundsPerYear: null };

test("ยังไม่ถึง 14 วันก่อนครบกำหนด — ยังไม่เปิดใบ", () => {
  const r = dueRounds(monthly, 14, d("2026-11-16"));
  assert.deepEqual(r.rounds, []);
  assert.equal(r.nextDueDate.toISOString().slice(0, 10), "2026-12-01");
});

test("ก่อนครบกำหนด 14 วันพอดี — เปิดใบรอบ 1 ธ.ค. แล้วแผนเดินไป 1 ม.ค.", () => {
  const r = dueRounds(monthly, 14, d("2026-11-17"));
  assert.deepEqual(r.rounds.map((x) => x.toISOString().slice(0, 10)), ["2026-12-01"]);
  assert.equal(r.nextDueDate.toISOString().slice(0, 10), "2027-01-01");
});

test("รอบถัดไปนับตามแผน ไม่ขึ้นกับวันปิดงาน — ค้างหลายรอบก็เปิดซ้อนครบทุกรอบ", () => {
  const r = dueRounds({ ...monthly, nextDueDate: d("2026-10-01"), anchorDate: d("2026-10-01") }, 14, d("2026-11-20"));
  assert.deepEqual(r.rounds.map((x) => x.toISOString().slice(0, 10)), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.equal(r.nextDueDate.toISOString().slice(0, 10), "2027-01-01");
});

test("กำหนดส่งของใบรอบ = สิ้นวันครบกำหนดเวลาไทย", () => {
  assert.equal(roundDueAt(d("2026-12-01")).toISOString(), "2026-12-01T16:59:59.999Z");
});

test("วันนี้ตามเวลาไทย — 23:30 UTC คือวันถัดไปของไทยแล้ว", () => {
  assert.equal(todayBkkDate(new Date("2026-11-30T23:30:00Z")).toISOString().slice(0, 10), "2026-12-01");
});

test("ใบรอบ PM ไม่มีผ่อนผัน ใบอื่นใช้ค่าบริษัท", () => {
  assert.equal(overdueGraceDays({ pmRoundDate: d("2026-12-01") }, 7), 0);
  assert.equal(overdueGraceDays({ pmRoundDate: null }, 7), 7);
});

test("เปิดใช้รายบริษัท · แผนนับครั้งใช้แบบเดิมเสมอ", () => {
  const on = { pmRoundsFrom: d("2026-11-03"), pmLeadDays: 14 };
  assert.equal(pmUsesRounds(on, { totalRounds: null }, d("2026-11-03")), true);
  assert.equal(pmUsesRounds(on, { totalRounds: 5 }, d("2026-11-03")), false);
  assert.equal(pmUsesRounds(on, { totalRounds: null }, d("2026-11-02")), false);
  assert.equal(pmUsesRounds({ pmRoundsFrom: null, pmLeadDays: 14 }, { totalRounds: null }, d("2026-11-03")), false);
});

test("รอบก่อนวันเริ่มใช้ = ไม่หักย้อนหลัง", () => {
  assert.equal(roundBeforeStart({ pmRoundDate: d("2026-10-01") }, d("2026-11-03")), true);
  assert.equal(roundBeforeStart({ pmRoundDate: d("2026-12-01") }, d("2026-11-03")), false);
});

const st = { workOrderGraceDays: 7, pmGraceDays: 7, scoringStartDate: null as Date | null, pmRoundsFrom: d("2026-11-03") };
const roundWo = {
  status: "open",
  dueDate: roundDueAt(d("2026-12-01")),
  completedAt: null,
  assignedTo: "sujita",
  caretakerId: null,
  pmRoundDate: d("2026-12-01"),
  overdueScore: null as string | null,
};
const dock = { userId: "sujita", occurredAt: new Date("2026-12-01T17:05:00Z") };

test("ใบรอบเลยกำหนดวันแรก (แม้บริษัทผ่อนผัน 7 วัน) — หักถูก ไม่คืน", () => {
  assert.equal(workOrderDockRevokeReason(dock, roundWo, st), null);
});

test("CEO ไม่หัก — คืน", () => {
  assert.equal(workOrderDockRevokeReason(dock, { ...roundWo, overdueScore: "waived" }, st), "CEO ยกเว้นคะแนนใบนี้");
});

test("CEO ไม่ต้องทำแต่หักไว้ (ยกเลิกใบ) — ไม่คืน", () => {
  assert.equal(workOrderDockRevokeReason(dock, { ...roundWo, status: "cancelled", overdueScore: "kept" }, st), null);
});

test("ยกเลิกใบรอบธรรมดา — คืนเหมือนเดิม", () => {
  assert.equal(workOrderDockRevokeReason(dock, { ...roundWo, status: "cancelled" }, st), "ใบงานถูกยกเลิก");
});

test("อนุมัติเลื่อนกำหนดหลังโดนหัก — คืน", () => {
  assert.equal(
    workOrderDockRevokeReason(dock, { ...roundWo, dueDate: roundDueAt(d("2026-12-08")) }, st),
    "เลื่อนกำหนดส่งหลังโดนหัก",
  );
});
