import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@smartboss/database";

import { withSalaryTenant } from "@/modules/salary/lib/db";
import { withOrgPair } from "./harness";

/**
 * เงินเดือนแยกบริษัทจริงที่ฐานข้อมูล (RLS FORCE + role workforce_app) — ผู้ใช้กำหนด 22/10/2569
 * "แยกข้อมูลแต่ละบริษัทออกจากกันนะ" · ทดสอบผ่าน withSalaryTenant ตัวเดียวกับที่แอปใช้
 * และรอบที่อนุมัติ/จ่ายแล้วแก้ตัวเลขไม่ได้ (trigger ในฐานข้อมูล ไม่ใช่แค่หน้าเว็บ)
 */

async function seedRun(orgId: string, period: string, status = "draft") {
  return withSalaryTenant(orgId, async (tx) => {
    const run = await tx.salaryRun.create({
      data: { orgId, period, startsOn: new Date("2026-09-26"), endsOn: new Date("2026-10-25"), payDate: new Date("2026-10-31"), createdBy: "test", createdByName: "test" },
    });
    await tx.salaryRunLine.create({
      data: { orgId, runId: run.id, employmentId: randomUUID(), name: "ลับมาก", gross: 50000, deductions: 875, net: 49125 },
    });
    if (status !== "draft") await tx.salaryRun.update({ where: { id: run.id }, data: { status } });
    return run.id;
  });
}

/** ล้างข้อมูลทดสอบ — owner + session_replication_role ข้าม trigger กันแก้รอบที่ล็อก (ทำได้เฉพาะ DB ทดสอบ/dev) */
async function cleanup(orgIds: string[]) {
  for (const orgId of orgIds) {
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRaw`SELECT set_config('salary.org_id', ${orgId}, true)`;
        await tx.$executeRawUnsafe(`DELETE FROM salary.run_lines WHERE org_id = $1`, orgId);
        await tx.$executeRawUnsafe(`DELETE FROM salary.runs WHERE org_id = $1`, orgId);
        await tx.$executeRawUnsafe(`DELETE FROM salary.settings WHERE org_id = $1`, orgId);
      })
      .catch((error: unknown) => console.error("[salary test] cleanup failed", error));
  }
}

test("บริษัท B มองไม่เห็น/แก้ไม่ได้ เงินเดือนของบริษัท A", async () => {
  await withOrgPair(async ({ orgA, orgB }) => {
    try {
      const runA = await seedRun(orgA, "2026-10");
      await withSalaryTenant(orgB, async (tx) => {
        assert.equal(await tx.salaryRun.count(), 0, "B เห็นรอบของ A");
        assert.equal(await tx.salaryRunLine.count(), 0, "B เห็นผลรายคนของ A");
        // ระบุ id ตรง ๆ ก็ไม่เจอ
        assert.equal(await tx.salaryRun.findFirst({ where: { id: runA } }), null);
        const upd = await tx.salaryRunLine.updateMany({ where: { runId: runA }, data: { net: 1 } });
        assert.equal(upd.count, 0, "B แก้ยอดของ A ได้");
      });
      // เขียนแถวที่อ้างว่าเป็นของ A จากบริษัท B ต้องโดนปฏิเสธ (WITH CHECK)
      await assert.rejects(
        withSalaryTenant(orgB, (tx) =>
          tx.salaryRun.create({ data: { orgId: orgA, period: "2026-11", startsOn: new Date("2026-10-26"), endsOn: new Date("2026-11-25"), payDate: new Date("2026-11-30"), createdBy: "x", createdByName: "x" } }),
        ),
      );
      // A ยังเห็นของตัวเองครบ
      await withSalaryTenant(orgA, async (tx) => {
        assert.equal(await tx.salaryRun.count(), 1);
        assert.equal(Number((await tx.salaryRunLine.findFirstOrThrow()).net), 49125);
      });
    } finally {
      await cleanup([orgA, orgB]);
    }
  });
});

test("ลืมตั้งบริษัท = ไม่เห็นอะไรเลย (fail closed)", async () => {
  await withOrgPair(async ({ orgA, orgB }) => {
    try {
      await seedRun(orgA, "2026-10");
      const seen = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
        return tx.salaryRunLine.count();
      });
      assert.equal(seen, 0);
    } finally {
      await cleanup([orgA, orgB]);
    }
  });
});

test("รอบที่อนุมัติแล้ว: ผลรายคนแก้/ลบไม่ได้ · รอบที่จ่ายแล้ว: แก้อะไรไม่ได้เลย", async () => {
  await withOrgPair(async ({ orgA, orgB }) => {
    try {
      const approved = await seedRun(orgA, "2026-10", "approved");
      await assert.rejects(withSalaryTenant(orgA, (tx) => tx.salaryRunLine.updateMany({ where: { runId: approved }, data: { net: 1 } })), /locked/);
      await assert.rejects(withSalaryTenant(orgA, (tx) => tx.salaryRunLine.deleteMany({ where: { runId: approved } })), /locked/);
      await withSalaryTenant(orgA, (tx) => tx.salaryRun.update({ where: { id: approved }, data: { status: "paid", paidAt: new Date() } }));
      await assert.rejects(withSalaryTenant(orgA, (tx) => tx.salaryRun.update({ where: { id: approved }, data: { status: "draft" } })), /paid/);
    } finally {
      await cleanup([orgA, orgB]);
    }
  });
});
