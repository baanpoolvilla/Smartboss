import test from "node:test";
import assert from "node:assert/strict";
import { canActOnTickets, isItDepartmentName, isSupportOrg, isTrustedSuperAdmin, supportRoleOf } from "../support-org";

const glc = { code: "SM0001", slug: "main" };
const other = { code: "SM0002", slug: "test" };

test("ไม่ตั้ง ISSUE_SUPPORT_ORG = ไม่มีใครเป็นทีมรับเรื่อง", () => {
  assert.equal(isSupportOrg(glc, null), false);
  assert.equal(supportRoleOf({ roles: ["CEO"], departmentName: "IT" }, glc, null), null);
});

test("จับคู่ด้วย code หรือ slug ไม่สนตัวพิมพ์", () => {
  assert.equal(isSupportOrg(glc, "sm0001"), true);
  assert.equal(isSupportOrg(glc, "MAIN"), true);
  assert.equal(isSupportOrg(other, "sm0001"), false);
  assert.equal(isSupportOrg(null, "sm0001"), false);
});

test("ชื่อแผนก IT", () => {
  for (const n of ["IT", "it", "แผนก IT", "IT Support", "แผนกไอที", "ไอที", "IT/Network", "ฝ่ายพัฒนาระบบ", "แผนกพัฒนาระบบ"]) assert.equal(isItDepartmentName(n), true, n);
  for (const n of ["Facility", "Digital", "Kit", "Audit", "บัญชี", "", null, undefined]) assert.equal(isItDepartmentName(n), false, String(n));
});

test("แผนก IT ของบริษัทเราเป็น 'it' (ชนะ CEO/ADMIN) — CEO/ADMIN ล้วนเป็น 'observer'", () => {
  assert.equal(supportRoleOf({ roles: ["STAFF"], departmentName: "IT" }, glc, "sm0001"), "it");
  assert.equal(supportRoleOf({ roles: ["CEO"], departmentName: "IT" }, glc, "sm0001"), "it");
  assert.equal(supportRoleOf({ roles: ["CEO"], departmentName: "บริหาร" }, glc, "sm0001"), "observer");
  assert.equal(supportRoleOf({ roles: ["ADMIN"] }, glc, "sm0001"), "observer");
  assert.equal(supportRoleOf({ roles: ["STAFF"], departmentName: "บัญชี" }, glc, "sm0001"), null);
});

test("บริษัทอื่นไม่ว่าแผนก/ตำแหน่งอะไรก็ไม่ได้สิทธิ์", () => {
  assert.equal(supportRoleOf({ roles: ["CEO"], departmentName: "IT" }, other, "sm0001"), null);
  assert.equal(supportRoleOf({ roles: ["ADMIN"] }, other, "sm0001"), null);
});

test("IT และ full ทำงานกับตั๋วได้ทุกบริษัท; observer (CEO/ADMIN) ทำไม่ได้", () => {
  assert.equal(canActOnTickets({ kind: "home", orgId: "o1", role: "it" }), true);
  assert.equal(canActOnTickets({ kind: "home", orgId: "o1", role: "observer" }), false);
  assert.equal(canActOnTickets({ kind: "full" }), true);
});

test("Super Admin: ตั้ง ISSUE_SUPPORT_ORG แล้วต้องสังกัดบริษัทเราเท่านั้น; ยังไม่ตั้ง = ผ่านทุกคนเหมือนเดิม", () => {
  assert.equal(isTrustedSuperAdmin(["SUPER_ADMIN"], glc, "sm0001"), true);
  assert.equal(isTrustedSuperAdmin(["SUPER_ADMIN"], other, "sm0001"), false);
  assert.equal(isTrustedSuperAdmin(["SUPER_ADMIN"], null, "sm0001"), false);
  assert.equal(isTrustedSuperAdmin(["SUPER_ADMIN"], other, null), true);
  assert.equal(isTrustedSuperAdmin(["CEO"], glc, "sm0001"), false);
});
