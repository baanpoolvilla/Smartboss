import { test } from "node:test";
import assert from "node:assert/strict";

import { canSeeRecord, canEditRecord } from "../scope";

const base = {
  viewerId: "viewer-1",
  viewerHeadOfDeptIds: [] as string[],
  viewerCanViewAll: false,
  recordCreatorId: null as string | null,
  recordDepartmentIds: [] as (string | null | undefined)[],
};

test("เจ้าของ record เห็นของตัวเองได้", () => {
  assert.equal(
    canSeeRecord({ ...base, recordCreatorId: "viewer-1" }),
    true
  );
});

test("record ของคนอื่นที่ไม่เกี่ยวข้อง มองไม่เห็น", () => {
  assert.equal(
    canSeeRecord({ ...base, recordCreatorId: "someone-else" }),
    false
  );
});

test("หัวหน้าแผนกเห็น record ที่สังกัดแผนกตัวเอง แม้ไม่ใช่คนสร้าง", () => {
  assert.equal(
    canSeeRecord({
      ...base,
      recordCreatorId: "someone-else",
      viewerHeadOfDeptIds: ["dept-sales"],
      recordDepartmentIds: ["dept-sales"],
    }),
    true
  );
});

test("หัวหน้าแผนกไม่เห็น record ของแผนกอื่นที่ตัวเองไม่ได้คุม", () => {
  assert.equal(
    canSeeRecord({
      ...base,
      recordCreatorId: "someone-else",
      viewerHeadOfDeptIds: ["dept-sales"],
      recordDepartmentIds: ["dept-marketing"],
    }),
    false
  );
});

test("หัวหน้าหลายแผนก เห็น record ที่สังกัดแผนกใดแผนกหนึ่งที่ตัวเองคุม", () => {
  assert.equal(
    canSeeRecord({
      ...base,
      recordCreatorId: "someone-else",
      viewerHeadOfDeptIds: ["dept-sales", "dept-marketing"],
      recordDepartmentIds: ["dept-marketing"],
    }),
    true
  );
});

test("record สังกัดหลายแผนก เห็นได้ถ้าเป็นหัวหน้าแผนกใดแผนกหนึ่งในนั้น", () => {
  assert.equal(
    canSeeRecord({
      ...base,
      recordCreatorId: "someone-else",
      viewerHeadOfDeptIds: ["dept-marketing"],
      recordDepartmentIds: ["dept-sales", "dept-marketing"],
    }),
    true
  );
});

test("core.data.view_all (viewerCanViewAll) ข้าม scope ได้ทั้งหมด", () => {
  assert.equal(
    canSeeRecord({
      ...base,
      viewerCanViewAll: true,
      recordCreatorId: "someone-else",
      recordDepartmentIds: ["dept-unrelated"],
    }),
    true
  );
});

test("record ไม่มี creator/แผนกเลย เห็นได้เฉพาะคนที่ viewAll", () => {
  assert.equal(canSeeRecord({ ...base }), false);
  assert.equal(canSeeRecord({ ...base, viewerCanViewAll: true }), true);
});

test("canEditRecord ใช้เกณฑ์เดียวกับ canSeeRecord", () => {
  assert.equal(canEditRecord, canSeeRecord);
});
