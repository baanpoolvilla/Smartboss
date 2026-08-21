import { test } from "node:test";
import assert from "node:assert/strict";

import { facetsOf, matchesFacet, UNSET } from "../contacts";

const row = (zone: string | null) => ({ zone });

test("เรียงตามจำนวนมากไปน้อย ไม่ใช่ตามตัวอักษร", () => {
  const f = facetsOf(
    [row("พัทยา"), row("บางแสน"), row("บางแสน"), row("บางแสน")],
    (r) => r.zone
  );
  assert.deepEqual(
    f.map((x) => [x.label, x.count]),
    [
      ["บางแสน", 3],
      ["พัทยา", 1],
    ]
  );
});

test("ช่องว่างหัวท้ายไม่ทำให้กลายเป็นสองโซนคนละอัน", () => {
  const f = facetsOf([row("พัทยา"), row(" พัทยา ")], (r) => r.zone);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.count, 2);
});

test('ค่าว่างกับ null รวมเป็นกลุ่ม "ยังไม่ระบุ" และอยู่ท้ายสุดเสมอ', () => {
  const f = facetsOf(
    [row(null), row(""), row("   "), row("พัทยา")],
    (r) => r.zone
  );
  assert.equal(f.at(-1)!.value, UNSET);
  assert.equal(f.at(-1)!.count, 3);
});

test("ไม่มีค่าว่างเลย ก็ไม่ต้องมีกลุ่มยังไม่ระบุ", () => {
  const f = facetsOf([row("พัทยา")], (r) => r.zone);
  assert.deepEqual(
    f.map((x) => x.value),
    ["พัทยา"]
  );
});

test("ไม่ได้เลือกตัวกรอง = ผ่านทุกแถว", () => {
  assert.equal(matchesFacet("พัทยา", null), true);
  assert.equal(matchesFacet(null, null), true);
});

test("เลือกกลุ่มยังไม่ระบุ ต้องได้เฉพาะแถวที่ว่างจริง", () => {
  assert.equal(matchesFacet(null, UNSET), true);
  assert.equal(matchesFacet("  ", UNSET), true);
  assert.equal(matchesFacet("พัทยา", UNSET), false);
});

test("เทียบค่าโดยตัดช่องว่าง ให้ตรงกับตอนนับ", () => {
  assert.equal(matchesFacet(" พัทยา ", "พัทยา"), true);
  assert.equal(matchesFacet("บางแสน", "พัทยา"), false);
});
