import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SUPER_ADMIN_ROLE,
  isDeniedToSuperAdmin,
  resolvePermission,
} from "../permissions";

const superAdmin = { permissions: [] as string[], roles: [SUPER_ADMIN_ROLE] };
const plainUser = { permissions: [] as string[], roles: ["STAFF"] };

test("SUPER_ADMIN ผ่านสิทธิ์ทั่วไปได้โดยไม่ต้องถือจริง", () => {
  assert.equal(
    resolvePermission({ ...superAdmin, permission: "admin.user.manage" }),
    true
  );
  assert.equal(
    resolvePermission({ ...superAdmin, permission: "maintenance.workorder.manage" }),
    true
  );
});

test("SUPER_ADMIN ข้ามสิทธิ์กลุ่มเงินเดือนรายบุคคลไม่ได้", () => {
  for (const perm of [
    "hr.salary.view",
    "hr.salary.manage",
    "hr.payroll.view",
    "hr.payroll.manage",
    "hr.payroll.approve",
  ]) {
    assert.equal(
      resolvePermission({ ...superAdmin, permission: perm }),
      false,
      `${perm} ต้องไม่ผ่านด้วย role อย่างเดียว`
    );
    assert.equal(isDeniedToSuperAdmin(perm), true);
  }
});

test("การตั้งค่าวิธีคำนวณเงินเดือนยังทำได้ — เป็นการตั้งค่าระบบ ไม่ใช่ข้อมูลส่วนบุคคล", () => {
  assert.equal(
    resolvePermission({ ...superAdmin, permission: "hr.setting.manage" }),
    true
  );
  assert.equal(isDeniedToSuperAdmin("hr.setting.manage"), false);
});

test("ถ้าได้รับมอบสิทธิ์เงินเดือนมาจริง ต้องผ่าน แม้จะเป็น SUPER_ADMIN", () => {
  assert.equal(
    resolvePermission({
      permissions: ["hr.payroll.view"],
      roles: [SUPER_ADMIN_ROLE],
      permission: "hr.payroll.view",
    }),
    true
  );
});

test("ผู้ใช้ทั่วไปที่ไม่มีสิทธิ์ ไม่ผ่าน", () => {
  assert.equal(
    resolvePermission({ ...plainUser, permission: "admin.user.manage" }),
    false
  );
});

test("ผู้ใช้ทั่วไปที่ถือสิทธิ์เงินเดือน (เช่น HR) ผ่านได้ตามปกติ", () => {
  assert.equal(
    resolvePermission({
      permissions: ["hr.payroll.view"],
      roles: ["HR_OFFICER"],
      permission: "hr.payroll.view",
    }),
    true
  );
});
