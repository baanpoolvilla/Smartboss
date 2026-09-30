import { test } from "node:test";
import assert from "node:assert/strict";

import { daysInPeriod, halfMonthPeriods, monthlyChunks, previousPeriod, weeklyPeriods } from "../periods";

test("ช่วงก่อนหน้ายาวเท่ากัน", () => {
  assert.deepEqual(previousPeriod({ from: "2026-06-01", to: "2026-06-15" }), { from: "2026-05-17", to: "2026-05-31" });
  assert.equal(daysInPeriod({ from: "2026-06-01", to: "2026-06-15" }), 15);
});

test("รายสัปดาห์: 7 วันล่าสุดถึงเมื่อวาน เทียบ 7 วันก่อนหน้า", () => {
  assert.deepEqual(weeklyPeriods("2026-09-28"), {
    period: { from: "2026-09-21", to: "2026-09-27" },
    compare: { from: "2026-09-14", to: "2026-09-20" },
  });
});

test("ครึ่งเดือน: วันที่ 1 และ 16 (ข้ามปีได้)", () => {
  assert.deepEqual(halfMonthPeriods("2026-03-01"), {
    period: { from: "2026-02-16", to: "2026-02-28" },
    compare: { from: "2026-02-01", to: "2026-02-15" },
  });
  assert.deepEqual(halfMonthPeriods("2026-01-16"), {
    period: { from: "2026-01-01", to: "2026-01-15" },
    compare: { from: "2025-12-16", to: "2025-12-31" },
  });
});

test("Backfill แบ่งเป็นรายเดือน", () => {
  assert.deepEqual(monthlyChunks({ from: "2026-01-20", to: "2026-03-05" }), [
    { from: "2026-01-20", to: "2026-01-31" },
    { from: "2026-02-01", to: "2026-02-28" },
    { from: "2026-03-01", to: "2026-03-05" },
  ]);
});
