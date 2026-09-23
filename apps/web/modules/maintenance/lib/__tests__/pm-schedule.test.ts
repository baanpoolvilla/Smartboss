import test from "node:test";
import assert from "node:assert/strict";
import {
  maxRoundsPerYear,
  roundsPerYearOptions,
  nextDueSlot,
  nextDueAfterCompletion,
  toDateOnly,
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

/**
 * กติกาวันกำหนดรอบถัดไปหลังปิดงาน — เจ้าของแจ้งเองว่า "ปิดไปแล้ว 14 และรอบเป็น
 * 1 เดือน ทำไมถึงขึ้นว่า 22 กย ละต้องเป็น 14 ตค สิ" (แผน PM ที่ anchor ตกวันที่ 22)
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);

test("ปิดช้ากว่ากำหนด: รอบ 1 เดือน ต้องได้เต็มเดือนนับจากวันที่ทำจริง", () => {
  const { nextDue, anchor } = nextDueAfterCompletion(
    {
      anchorDate: new Date(Date.UTC(2026, 7, 22)), // anchor ตกวันที่ 22
      nextDueDate: new Date(Date.UTC(2026, 7, 22)), // ครบกำหนด 22 ส.ค.
      frequency: "monthly",
      roundsPerYear: null,
    },
    new Date(Date.UTC(2026, 8, 14, 5)) // ปิดจริง 14 ก.ย.
  );
  assert.equal(iso(nextDue), "2026-10-14"); // ไม่ใช่ 22 ก.ย. (อีกแค่ 8 วัน)
  assert.equal(iso(anchor), "2026-09-14"); // ย้ายหลักมาที่วันที่ทำจริง
});

test("ปิดก่อนกำหนด: ยังนับจากวันกำหนดเดิม ไม่ให้รอบคืบเข้ามาทุกครั้ง", () => {
  const { nextDue } = nextDueAfterCompletion(
    {
      anchorDate: new Date(Date.UTC(2026, 9, 22)),
      nextDueDate: new Date(Date.UTC(2026, 9, 22)), // ครบกำหนด 22 ต.ค.
      frequency: "monthly",
      roundsPerYear: null,
    },
    new Date(Date.UTC(2026, 9, 20, 3)) // ทำเสร็จก่อน 2 วัน
  );
  assert.equal(iso(nextDue), "2026-11-22");
});

test("ความถี่แบบสัปดาห์นับเป็นวัน", () => {
  const { nextDue } = nextDueAfterCompletion(
    {
      anchorDate: new Date(Date.UTC(2026, 8, 1)),
      nextDueDate: new Date(Date.UTC(2026, 8, 1)),
      frequency: "biweekly",
      roundsPerYear: null,
    },
    new Date(Date.UTC(2026, 8, 5, 8)) // ปิดช้า 4 วัน
  );
  assert.equal(iso(nextDue), "2026-09-19"); // 5 ก.ย. + 14 วัน
});

test("โหมดรอบต่อปี: ยังตรึงช่องเวลาไว้กับปฏิทินเหมือนเดิม ไม่ย้าย anchor", () => {
  const { nextDue, anchor } = nextDueAfterCompletion(
    {
      anchorDate: new Date(Date.UTC(2026, 1, 25)), // 25 ก.พ.
      nextDueDate: new Date(Date.UTC(2026, 8, 25)), // รอบที่ 2 ของทุก 7 เดือน
      frequency: "month7",
      roundsPerYear: 2,
      },
    new Date(Date.UTC(2026, 9, 10, 2)) // ปิดช้าไป 15 วัน
  );
  // ช่องถัดไปตามปฏิทินคือ 25 ก.พ. 27 — ไม่ถูกข้ามทิ้งเพราะปิดงานช้า
  assert.equal(iso(nextDue), "2027-02-25");
  assert.equal(iso(anchor), "2026-02-25"); // โหมดนี้ไม่ย้าย anchor
});

test("ปิดงานตีสองตามเวลาไทย ต้องนับเป็นวันของไทย ไม่ใช่วันก่อนหน้าของ UTC", () => {
  // 13 ก.ย. 19:00Z = 14 ก.ย. 02:00 ตามเวลาไทย
  assert.equal(iso(toDateOnly(new Date(Date.UTC(2026, 8, 13, 19)))), "2026-09-14");
});
