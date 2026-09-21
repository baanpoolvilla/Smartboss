import test from "node:test";
import assert from "node:assert/strict";
import { canActOnTicketOrg, isSupportOrg, isSupportStaff } from "../support-org";

const glc = { code: "GLC", slug: "goodluckland" };
const other = { code: "ABC", slug: "abc-co" };

test("ไม่ตั้ง ISSUE_SUPPORT_ORG = ไม่มีใครเป็นทีมรับเรื่อง", () => {
  assert.equal(isSupportOrg(glc, null), false);
  assert.equal(isSupportStaff(["CEO"], glc, null), false);
});

test("จับคู่ด้วย code หรือ slug ไม่สนตัวพิมพ์", () => {
  assert.equal(isSupportOrg(glc, "glc"), true);
  assert.equal(isSupportOrg(glc, "goodluckland"), true);
  assert.equal(isSupportOrg(other, "goodluckland"), false);
  assert.equal(isSupportOrg(null, "glc"), false);
});

test("เฉพาะ CEO/ADMIN ของบริษัทเราเป็นทีมรับเรื่อง — บริษัทอื่นไม่ว่าตำแหน่งอะไรก็ไม่", () => {
  assert.equal(isSupportStaff(["CEO"], glc, "glc"), true);
  assert.equal(isSupportStaff(["ADMIN", "STAFF"], glc, "glc"), true);
  assert.equal(isSupportStaff(["STAFF"], glc, "glc"), false);
  assert.equal(isSupportStaff(["CEO"], other, "glc"), false);
  assert.equal(isSupportStaff(["ADMIN"], other, "glc"), false);
});

test("home แก้ได้เฉพาะตั๋วบริษัทตัวเอง, full แก้ได้ทุกบริษัท", () => {
  assert.equal(canActOnTicketOrg({ kind: "home", orgId: "o1" }, "o1"), true);
  assert.equal(canActOnTicketOrg({ kind: "home", orgId: "o1" }, "o2"), false);
  assert.equal(canActOnTicketOrg({ kind: "full" }, "o2"), true);
});
