import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@smartboss/database";
import type { OrgSession } from "@smartboss/auth";

import { assertManageableUser, syncUserToWorkforce } from "@/modules/admin/data/user-guards";
import { withOrgPair } from "./harness";

/**
 * ปักพฤติกรรมของ 2 จุดรวมความไว้ใจ (concentration of trust) ที่เจอจาก
 * tenant-isolation audit — กันเผลอถอยในอนาคต ไม่ใช่พิสูจน์บั๊กใหม่ (audit
 * รอบก่อนสรุปว่าทั้งสองจุดปลอดภัย "วันนี้" เพราะทุก caller ปัจจุบัน validate
 * มาก่อนแล้ว เทสต์นี้คือ safety net กัน caller ในอนาคตที่ลืม)
 */

function orgAdminSession(orgId: string, userId: string): OrgSession {
  return { userId, orgId, roles: ["ADMIN"], permissions: [] };
}

async function makeUser(orgId: string, email: string) {
  return prisma.user.create({
    data: { orgId, email, name: email, passwordHash: "test-not-a-real-hash", isActive: true },
  });
}

test("assertManageableUser ปฏิเสธ user ข้ามบริษัท (ไม่ใช่ SUPER_ADMIN)", async () => {
  await withOrgPair(async ({ orgA, orgB }) => {
    const userInB = await makeUser(orgB, `${crypto.randomUUID()}@example.com`);
    const adminOfA = orgAdminSession(orgA, "admin-a");

    await assert.rejects(
      () => assertManageableUser(adminOfA, userInB.id),
      /ไม่พบผู้ใช้ที่จัดการได้/,
      "แอดมินของบริษัท A ต้องจัดการ user ของบริษัท B ไม่ได้ — orgId ไม่ตรงต้องถูกปฏิเสธเสมอ"
    );
  });
});

test("assertManageableUser ผ่านปกติสำหรับ user บริษัทเดียวกัน", async () => {
  await withOrgPair(async ({ orgA }) => {
    const userInA = await makeUser(orgA, `${crypto.randomUUID()}@example.com`);
    const adminOfA = orgAdminSession(orgA, "admin-a");

    const result = await assertManageableUser(adminOfA, userInA.id);
    assert.equal(result.id, userInA.id);
  });
});

test("syncUserToWorkforce ไม่ sync ถ้า expectedOrgId ไม่ตรงกับ orgId จริงของ user", async () => {
  await withOrgPair(async ({ orgA, orgB }) => {
    const userInB = await makeUser(orgB, `${crypto.randomUUID()}@example.com`);

    const originalError = console.error;
    let loggedMismatch = false;
    console.error = (...args: unknown[]) => {
      if (String(args[0]).includes("expectedOrgId ไม่ตรงกับ orgId จริง")) loggedMismatch = true;
    };
    try {
      // เรียกด้วย orgA ทั้งที่ user จริงอยู่ orgB — จำลอง caller ที่ลืม
      // validate มาก่อน (หรือ validate ผิดบริษัท) ฟังก์ชันต้อง "ไม่ทำงาน"
      // (ไม่ throw ตามดีไซน์เดิม แต่ต้องไม่ไปเรียก syncWorkforcePrincipal จริง
      // — สังเกตทางอ้อมผ่าน log ที่ควรเกิดขึ้นแทน)
      await assert.doesNotReject(() => syncUserToWorkforce(userInB.id, orgA, "actor-1"));
      assert.ok(loggedMismatch, "ต้อง log เตือนเมื่อ expectedOrgId ไม่ตรง ไม่ใช่เงียบสนิท");
    } finally {
      console.error = originalError;
    }
  });
});
