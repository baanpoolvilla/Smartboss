import { test } from "node:test";
import assert from "node:assert/strict";

import { CROSS_ORG_REASONS, crossOrg, activeCrossOrgReason } from "./cross-org";

/**
 * Snapshot รายการ CROSS_ORG_REASONS ไว้ตรง ๆ — เพิ่ม/ลบเหตุผลใหม่ต้องมาแก้
 * เทสต์นี้ด้วยเสมอ (คู่กับ TS ที่บังคับ literal union อยู่แล้ว) กันเผลอเพิ่ม
 * escape hatch โดยไม่มีใครรีวิว ตามหลักการข้อ 3-4 ใน cross-org.ts
 *
 * รายการยาวขึ้น = ต้องมีเหตุผลจริงมาต่อท้าย ไม่ใช่แค่แก้เลขให้ผ่าน
 */
test("CROSS_ORG_REASONS มีแค่เหตุผลที่รีวิวแล้ว ไม่งอกเงียบ ๆ", () => {
  assert.deepEqual(
    [...CROSS_ORG_REASONS].sort(),
    [
      "auth:lookup-by-globally-unique-external-id",
      "cron:platform-job-resolves-org-per-row",
      "notification:recipient-scoped-not-org-scoped",
    ].sort(),
    "รายการเหตุผลเปลี่ยนไปจากที่รีวิวไว้ — ถ้าเพิ่มใหม่จริง อัปเดต snapshot " +
      "นี้ให้ตรงกับ cross-org.ts (และอธิบายเหตุผลไว้เป็นคอมเมนต์ที่นั่นด้วย)"
  );
});

test("crossOrg() ทำให้ activeCrossOrgReason() เห็นเฉพาะระหว่าง callback เท่านั้น", async () => {
  assert.equal(activeCrossOrgReason(), undefined);

  const seen = await crossOrg("cron:platform-job-resolves-org-per-row", async () => activeCrossOrgReason());
  assert.equal(seen, "cron:platform-job-resolves-org-per-row");

  // ออกจาก callback แล้วต้องหายไป — ไม่ใช่ global flag ที่ค้างข้าม query อื่น
  assert.equal(activeCrossOrgReason(), undefined);
});
