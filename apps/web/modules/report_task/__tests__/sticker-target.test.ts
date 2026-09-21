import test from "node:test";
import assert from "node:assert/strict";
import { reactionCountsFor, reactionRecipients, reactionTargetLabel } from "../lib/sticker-target";

test("สติกเกอร์ทั้งกลุ่ม (ไม่มี target) นับให้ทุกคน", () => {
  assert.equal(reactionCountsFor({}, "u1"), true);
  assert.equal(reactionCountsFor({}, "u2"), true);
  assert.equal(reactionCountsFor({}), true);
});

test("สติกเกอร์รายคน นับเฉพาะคนนั้น (ยอดรวมทั้งงานยังนับ)", () => {
  assert.equal(reactionCountsFor({ targetUserId: "u1" }, "u1"), true);
  assert.equal(reactionCountsFor({ targetUserId: "u1" }, "u2"), false);
  assert.equal(reactionCountsFor({ targetUserId: "u1" }), true);
});

test("ป้ายผู้รับ: ชื่อคน หรือ ทั้งกลุ่ม", () => {
  const names: Record<string, string> = { u1: "สมชาย" };
  assert.equal(reactionTargetLabel({ targetUserId: "u1" }, (id) => names[id]), "สมชาย");
  assert.equal(reactionTargetLabel({}, (id) => names[id]), "ทั้งกลุ่ม");
  assert.equal(reactionTargetLabel({ targetUserId: "zz" }, (id) => names[id]), "ไม่ทราบชื่อ");
});

test("ผู้รับแจ้งเตือน: คนที่เลือก (ต้องเป็นผู้รับผิดชอบ) หรือทุกคน", () => {
  assert.deepEqual(reactionRecipients(["u1", "u2"], "u2"), ["u2"]);
  assert.deepEqual(reactionRecipients(["u1", "u2"]), ["u1", "u2"]);
  assert.deepEqual(reactionRecipients(["u1", "u2"], "ghost"), ["u1", "u2"]);
});
