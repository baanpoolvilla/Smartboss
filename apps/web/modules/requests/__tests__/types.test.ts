import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advanceCap,
  amountMismatch,
  baht,
  contractorBreakdown,
  minutesBetween,
  normalizeDate,
  otCalc,
  parseMoney,
  receiptFlags,
  statusInfo,
  timesOverlap,
} from "../lib/types";

test("เงิน: แสดงทศนิยมเฉพาะเมื่อมีสตางค์ และครบ 2 ตำแหน่ง", () => {
  assert.equal(baht(1250), "฿1,250");
  assert.equal(baht(1250.5), "฿1,250.50");
  assert.equal(baht(-60), "−฿60");
  assert.equal(parseMoney("฿ 1,500.50"), 1500.5);
  assert.ok(Number.isNaN(parseMoney("abc")));
});

test("ช่างภายนอก: หัก ณ ที่จ่ายคิดจากยอดก่อน VAT", () => {
  const b = contractorBreakdown(10000, 7, 3);
  assert.equal(b.vat, 700);
  assert.equal(b.gross, 10700);
  assert.equal(b.wht, 300);
  assert.equal(b.net, 10400);
  const noVat = contractorBreakdown(4500, 0, 3);
  assert.equal(noVat.net, 4365);
});

test("OT: พนักงาน เงินเดือน ÷ 30 ÷ 8 · คนงาน ค่าแรง ÷ 8", () => {
  const staff = otCalc("monthly", 15000, 150, 180);
  assert.equal(staff.hourly, 62.5);
  assert.equal(staff.amount, 281.25);
  const worker = otCalc("daily", 400, 150, 180);
  assert.equal(worker.amount, 225);
  assert.equal(minutesBetween("22:00", "02:00"), 240);
});

test("OT ซ้อนเวลากันจับได้ แม้ข้ามเที่ยงคืน", () => {
  assert.equal(timesOverlap("17:00", "19:00", "18:30", "20:00"), true);
  assert.equal(timesOverlap("17:00", "19:00", "19:00", "21:00"), false);
  assert.equal(timesOverlap("22:00", "02:00", "01:00", "03:00"), true);
});

test("ปี พ.ศ. ในช่องวันที่ถูกแปลงกลับเป็น ค.ศ.", () => {
  assert.equal(normalizeDate("2569-10-21"), "2026-10-21");
  assert.equal(normalizeDate("2026-10-21"), "2026-10-21");
  assert.equal(normalizeDate("21/10/2026"), "");
});

test("ใบเสร็จ: ซ้ำ/วันที่ในอนาคต = ส่งไม่ได้ · วันที่ไม่ตรง/เก่า = เตือน", () => {
  const ctx = { claimDate: "2026-10-20", today: "2026-10-21", maxAgeDays: 60 };
  assert.equal(receiptFlags({ ai: null }, { ...ctx, duplicateOf: "REQ-2569-0001" })[0]?.level, "block");
  const future = receiptFlags({ ai: { amount: 60, date: "2026-10-25", vendor: null, receiptNo: null, isReceipt: true, notes: null } }, ctx);
  assert.ok(future.some((f) => f.level === "block"));
  const old = receiptFlags({ ai: { amount: 60, date: "2026-07-01", vendor: null, receiptNo: null, isReceipt: true, notes: null } }, ctx);
  assert.ok(old.every((f) => f.level === "warn") && old.length === 2);
  assert.equal(amountMismatch([{ ai: { amount: 60, date: null, vendor: null, receiptNo: null, isReceipt: true, notes: null } }], 120), "ยอดในใบเสร็จรวม ฿60 แต่ขอเบิก ฿120");
});

test("เพดานเบิกล่วงหน้า", () => {
  assert.equal(advanceCap("none", 0, null), null);
  assert.equal(advanceCap("baht", 3000, null), 3000);
  assert.equal(advanceCap("days", 5, 400), 2000);
  assert.equal(advanceCap("days", 5, null), null);
});

test("สถานะบอกขั้นต่อไปถูก", () => {
  const base = { approverLevel: "hr" as const, paidTotal: 0, netAmount: 100, clearStatus: null, deductAmount: 0, deductedAt: null };
  assert.equal(statusInfo({ ...base, kind: "advance", status: "pending", approverLevel: "ceo", beneficiaryKind: "worker" }).label, "รอ CEO อนุมัติ");
  assert.equal(statusInfo({ ...base, kind: "ot", status: "paid", beneficiaryKind: "worker" }).label, "เข้าบัญชีค่าแรงแล้ว");
  assert.equal(statusInfo({ ...base, kind: "cash_advance", status: "paid", beneficiaryKind: "staff", paidTotal: 100 }).label, "จ่ายแล้ว · รอเคลียร์");
  assert.equal(statusInfo({ ...base, kind: "advance", status: "paid", beneficiaryKind: "staff", paidTotal: 100, deductAmount: 100 }).label, "จ่ายแล้ว · รอหักเงินเดือน");
});
