import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { withOrgPair } from "./harness";

/**
 * Smoke test — พิสูจน์ว่า harness + Prisma client จริง + tenant-guard +
 * TENANT_GUARD=strict ต่อกันติดจริงแบบ end-to-end ก่อนเชื่อเทสต์อื่นที่จะ
 * สร้างต่อบนรากนี้ (fix-list ข้อ 1 track B ขั้นที่ 2)
 *
 * ต้อง assert สองทิศเสมอ ไม่ใช่แค่ "throw ได้" — เทสต์ที่เช็คแค่ "โยน error"
 * จะเขียวเหมือนกันแม้การ์ดพังจนโยนทุก query (แม้ query ที่ถูกต้องแล้ว) หัวใจ
 * ของสมอลก์เทสต์นี้คือพิสูจน์ว่าการ์ด "แยกแยะถูก" — ปล่อยผ่านของที่กรอง
 * orgId มาแล้ว/escape hatch ที่รีวิวแล้ว แต่บล็อกเฉพาะของที่ไม่ได้กรองจริง ๆ
 *
 * ใช้ ExampleItem (core.prisma) — โมเดลตัวอย่างเปล่า ๆ ไม่มีความหมายทางธุรกิจ
 * เลือกเพราะชนข้อมูลจริงไม่ได้ ปลอดภัยสุดสำหรับเทสต์ที่จงใจยิง query ผิด ๆ
 */
test("tenant-guard แยกแยะถูก ภายใต้ TENANT_GUARD=strict", async () => {
  assert.equal(
    process.env.TENANT_GUARD,
    "strict",
    "เทสต์นี้ต้องรันด้วย TENANT_GUARD=strict ไม่งั้นพิสูจน์อะไรไม่ได้เลย — เช็ค env ก่อนรัน"
  );

  await withOrgPair(async ({ orgA }) => {
    // ทิศที่ 1 — ไม่มี orgId เลย ต้องโดนบล็อก
    await assert.rejects(
      () => prisma.exampleItem.findMany({ where: { title: "smoke-test-no-org-filter" } }),
      /tenant-guard/,
      "query ที่ไม่กรอง orgId บนโมเดลที่อยู่ใน allowlist ต้อง throw ใต้ strict mode"
    );

    // ทิศที่ 2 — มี orgId ถูกต้อง ต้องผ่านปกติ ไม่ throw
    await assert.doesNotReject(
      () => prisma.exampleItem.findMany({ where: { orgId: orgA, title: "smoke-test-with-org-filter" } }),
      "query ที่กรอง orgId ไว้แล้วต้องไม่ถูกบล็อก แม้อยู่ในโมเดลเดียวกัน"
    );

    // ทิศที่ 3 — ไม่มี orgId แต่ห่อด้วย crossOrg (reason ที่รีวิวแล้วจริง) ต้อง
    // ผ่านปกติเหมือนกัน — พิสูจน์ escape hatch เอง ไม่ใช่แค่ path ปกติ
    await assert.doesNotReject(
      () =>
        crossOrg("notification:recipient-scoped-not-org-scoped", () =>
          prisma.exampleItem.findMany({ where: { title: "smoke-test-cross-org-escape-hatch" } })
        ),
      "query ที่ห่อด้วย crossOrg(reason ที่ถูกต้อง) ต้องไม่ถูกบล็อก แม้ไม่มี orgId ใน where เลย"
    );
  });
});
