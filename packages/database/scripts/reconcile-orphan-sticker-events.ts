import { PrismaClient, Prisma } from "@prisma/client";

/**
 * คืนคะแนนของสติกเกอร์งาน (Kanban) ที่ถูกยกเลิกไปแล้ว แต่คะแนนยังค้างหักอยู่
 *
 * ที่มา: ก่อนแก้ writeTasks (task-repo.ts) การยกเลิกสติกเกอร์ที่หน้างานลบแค่ reaction ออกจากงาน
 * ไม่เคยแตะ core.performance_events ⇒ "หักคะแนนโดยหัวหน้า" (refType task_reaction) ยังค้างที่
 * คะแนน & เกรดของพนักงาน ตอนนี้ยกเลิกแล้วระบบคืนให้เอง สคริปต์นี้แก้ของเก่าที่ค้างอยู่แล้ว
 *
 * วิธีตรวจ: ไล่ทุก event task_reaction ต่อบริษัท → ดึง reaction id จาก refId ("<reactionId>:<userId>")
 * → ถ้าไม่มี reaction นั้นในงานใดของบริษัทแล้ว และยังไม่มี task_reaction_undo คู่กัน
 * ให้ออก event points ตรงข้าม ลงวันเดียวกับของเดิม (ไม่ลบ/ไม่แก้ของเดิม — ประวัติ audit อ่านย้อนได้)
 *
 * รัน (บนเซิร์ฟเวอร์ source /etc/smartboss/smartboss.env ก่อน):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/reconcile-orphan-sticker-events.ts --dry-run
 *      เอา --dry-run ออกเพื่อเขียนจริง (รันซ้ำได้ ไม่คืนซ้ำ)
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

interface ReactionLike {
  id: string;
  stickerId: string;
}
interface TaskLike {
  title?: string;
  reactions?: ReactionLike[];
}

async function main() {
  const events = await prisma.performanceEvent.findMany({
    where: { source: "report_task", category: "task_manual_dock", refType: "task_reaction" },
    select: { orgId: true, userId: true, points: true, occurredAt: true, refId: true, note: true, createdBy: true },
  });
  if (events.length === 0) {
    console.log("ไม่มีเหตุการณ์สติกเกอร์งานเลย");
    return;
  }

  const orgIds = [...new Set(events.map((e) => e.orgId))];
  const undone = new Set(
    (
      await prisma.performanceEvent.findMany({
        where: { source: "report_task", category: "task_manual_dock", refType: "task_reaction_undo" },
        select: { orgId: true, refId: true },
      })
    ).map((u) => `${u.orgId}|${u.refId}`),
  );

  let total = 0;
  for (const orgId of orgIds) {
    const rows = await prisma.reportTask.findMany({ where: { orgId }, select: { data: true } });
    const alive = new Set<string>();
    for (const row of rows) {
      for (const r of (row.data as unknown as TaskLike).reactions ?? []) alive.add(r.id);
    }

    const orphans = events.filter((e) => {
      if (e.orgId !== orgId || !e.refId) return false;
      const reactionId = e.refId.split(":")[0];
      return !alive.has(reactionId) && !undone.has(`${orgId}|${e.refId}`);
    });
    if (orphans.length === 0) continue;

    const sum = orphans.reduce((acc, e) => acc + Number(e.points), 0);
    console.log(`[${orgId}] สติกเกอร์ที่ถูกยกเลิกแต่คะแนนยังค้าง ${orphans.length} รายการ (รวม ${sum} แต้ม จะคืน ${-sum})`);
    for (const e of orphans) console.log(`   ${e.userId}  ${e.points}  ${e.note ?? ""}`);
    total += orphans.length;
    if (dryRun) continue;

    await prisma.performanceEvent.createMany({
      data: orphans.map((e) => ({
        orgId,
        userId: e.userId,
        source: "report_task",
        category: "task_manual_dock",
        points: new Prisma.Decimal(e.points).neg(),
        occurredAt: e.occurredAt,
        refType: "task_reaction_undo",
        refId: e.refId,
        note: `ยกเลิก: ${e.note ?? ""}`,
        createdBy: e.createdBy, // ต้องมีค่า — rebuild-performance-events ลบเฉพาะรายการที่ created_by ว่าง
      })),
      skipDuplicates: true,
    });
  }

  console.log(dryRun ? `\n[dry-run] พบ ${total} รายการ — ยังไม่เขียนอะไร` : `\nคืนคะแนนแล้ว ${total} รายการ`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
