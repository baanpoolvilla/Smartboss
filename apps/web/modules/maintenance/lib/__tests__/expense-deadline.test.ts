import assert from "node:assert/strict";
import { expenseDaysLabel, expenseDaysLeft, expenseDueAt, isExpenseBacklog, trackingActive, type ExpenseTracking } from "../expense-deadline";

const t: ExpenseTracking = { from: new Date("2026-11-10T00:00:00.000Z"), days: 14, recorderIds: ["hr"] };
const at = (s: string) => new Date(s);

// ปิด/เปิดใช้
assert.equal(trackingActive({ ...t, from: null }, at("2026-12-01T00:00:00+07:00")), false);
assert.equal(trackingActive(t, at("2026-11-09T23:59:00+07:00")), false);
assert.equal(trackingActive(t, at("2026-11-10T00:00:00+07:00")), true);

// ปิดงานวันไหน นับตามวันไทย — 23:30 วันที่ 12 เวลาไทย = 16:30Z ยังเป็นวันที่ 12
const late = at("2026-11-12T23:30:00+07:00");
assert.equal(isExpenseBacklog({ completedAt: late }, t), false);
assert.equal(expenseDueAt({ completedAt: late }, t).toISOString(), at("2026-11-26T23:59:59.999+07:00").toISOString());
// 00:30 ไทยของวันที่ 13 ยังเป็นวันที่ 12 ใน UTC ต้องนับเป็นวันที่ 13
assert.equal(expenseDueAt({ completedAt: at("2026-11-13T00:30:00+07:00") }, t).toISOString(), at("2026-11-27T23:59:59.999+07:00").toISOString());

// ของค้างเก่านับจากวันเริ่มใช้
const old = { completedAt: at("2026-08-01T10:00:00+07:00") };
assert.equal(isExpenseBacklog(old, t), true);
assert.equal(expenseDueAt(old, t).toISOString(), at("2026-11-24T23:59:59.999+07:00").toISOString());

// CEO อนุมัติเลื่อน
const moved = at("2026-12-31T23:59:59.999+07:00");
assert.equal(expenseDueAt({ completedAt: late, expenseDueDate: moved }, t), moved);

// เหลือกี่วัน
const due = at("2026-11-26T23:59:59.999+07:00");
assert.equal(expenseDaysLeft(due, at("2026-11-21T09:00:00+07:00")), 5);
assert.equal(expenseDaysLeft(due, at("2026-11-26T22:00:00+07:00")), 0);
assert.equal(expenseDaysLeft(due, at("2026-11-29T01:00:00+07:00")), -3);
assert.equal(expenseDaysLabel(5), "เหลือ 5 วัน");
assert.equal(expenseDaysLabel(0), "ครบกำหนดวันนี้");
assert.equal(expenseDaysLabel(-3), "เลยกำหนด 3 วัน");

console.log("expense-deadline ok");
