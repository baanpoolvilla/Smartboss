import test from "node:test";
import assert from "node:assert/strict";
import {
  maxRoundsPerYear,
  roundsPerYearOptions,
  nextDueSlot,
} from "../pm-schedule.ts";

/**
 * สองเคสนี้เคยพังจริงใน ChangYai แล้วถูกแก้ที่นั่น (commit c0eb95b, 59a08f6)
 * เขียนเทสต์ไว้เพราะทั้งคู่ **พังแบบเงียบ** — ไม่มี error ให้เห็น
 * มีแต่ PM ที่ไม่ขยับรอบ กับตัวเลือกที่หายไปจากหน้าจอ
 */

test("ทุก 7 เดือน ต้องเลือกรอบต่อปีได้ (12 หารไม่ลงตัว)", () => {
  // ปัดลงจะได้ 1 แล้วโดนเงื่อนไข "> 1" ตัดทิ้ง กลายเป็นเลือกอะไรไม่ได้เลย
  assert.equal(maxRoundsPerYear("month7"), 2);
  assert.deepEqual(roundsPerYearOptions("month7"), [1, 2]);
});

test("ความถี่ที่หาร 12 ลงตัว ตัดตัวเลือกสุดท้ายทิ้ง", () => {
  // ทุก 3 เดือน 4 รอบ/ปี = แบบต่อเนื่องอยู่แล้ว ไม่ควรมีสองทางที่ผลเหมือนกัน
  assert.deepEqual(roundsPerYearOptions("quarterly"), [1, 2, 3]);
});

test("ความถี่ที่กำหนดรอบต่อปีไม่ได้ คืนลิสต์ว่าง", () => {
  assert.deepEqual(roundsPerYearOptions("annual"), []);
  assert.deepEqual(roundsPerYearOptions("weekly"), []);
});

test("จบงานก่อนกำหนด ต้องขยับไปรอบหน้า ไม่ใช่วนรอบเดิม", () => {
  const anchor = new Date(Date.UTC(2026, 1, 25)); // 25 ก.พ. 26
  const due = new Date(Date.UTC(2026, 8, 25)); // รอบที่ 2 ของทุก 7 เดือน
  const early = new Date(Date.UTC(2026, 8, 20)); // ช่างจบก่อน 5 วัน

  // ใช้วันที่กดจบตรง ๆ = ได้วันกำหนดเดิมกลับมา (พฤติกรรมที่ผิด)
  assert.equal(
    nextDueSlot(anchor, "month7", 2, early).toISOString().slice(0, 10),
    "2026-09-25"
  );

  // ต้องนับจากวันกำหนดของรอบที่เพิ่งจบ จึงจะขยับ
  const after = due > early ? due : early;
  assert.equal(
    nextDueSlot(anchor, "month7", 2, after).toISOString().slice(0, 10),
    "2027-02-25"
  );
});
