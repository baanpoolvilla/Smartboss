import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

/**
 * เติมเหตุการณ์ "ส่งงานเลยกำหนด" (task_late) ที่ควรมีแต่ไม่เคยถูกสร้าง — เฉพาะ
 * งานโหมด "กลุ่ม" (มอบหมายหลายคน)
 *
 * ที่มา: /api/report-task/tasks/sweep/route.ts เดิมอ่านแค่ task.penalty (งาน
 * เดี่ยว) ตอนสร้างเหตุการณ์เข้า core.performance_events — งานโหมดกลุ่มหัก
 * คะแนนผ่าน task.penalties (รายคน) แทน ซึ่งลูปนั้นไม่เคยอ่านฟิลด์นี้เลย
 * ผลคือการ์ดบนบอร์ด Kanban ขึ้นหักคะแนนให้เห็นตามปกติ แต่คะแนนรวมที่หน้า
 * /admin/performance ของผู้บริหารไม่เคยเปลี่ยนตามเลยสักครั้ง (ดู commit ที่แก้
 * route.ts ให้อ่าน task.penalties ด้วย) — สคริปต์นี้เติมเฉพาะเหตุการณ์ที่
 * "ขาดไป" ให้ตรงกับสิ่งที่บอร์ดแสดงมาตลอด ไม่แตะ/ไม่แก้เหตุการณ์ที่มีอยู่แล้ว
 *
 * ใช้ตัวเลขคะแนนที่บันทึกไว้ในตัวงานเอง (penalty.points ที่พนักงานเห็นบนการ์ด
 * มาตลอด) ไม่ใช่ค่าปัจจุบันของ rulePoints.task_late — เพื่อให้คะแนนที่เติม
 * ย้อนหลังตรงกับสิ่งที่ระบบเคยประกาศไว้กับพนักงานจริง ๆ
 *
 * ปลอดภัยเมื่อรันซ้ำ: ใช้ unique constraint เดียวกับ recordPerformanceEvents
 * (orgId, source, category, refType, refId) + skipDuplicates
 *
 * รัน: pnpm --filter @smartboss/database exec tsx scripts/backfill-missing-group-task-late-events.ts
 *      เติม --dry-run เพื่อดูว่าจะเพิ่มอะไรบ้างโดยยังไม่เขียนลงฐานข้อมูล
 */

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

interface TaskPenaltyShape {
  points: number;
  byUserId: string;
  appliedAt: string;
  reason?: string;
}

interface TaskDataShape {
  title?: string;
  taskMode?: string;
  missedDeadlineOnce?: boolean;
  penalties?: Record<string, TaskPenaltyShape>;
  dueDate?: string;
}

async function main() {
  const settings = await prisma.performanceSetting.findMany({
    select: { orgId: true, enabled: true },
  });
  const enabledByOrg = new Map(settings.map((s) => [s.orgId, s.enabled]));

  const tasks = await prisma.reportTask.findMany({
    where: { taskMode: "group" },
    select: { id: true, orgId: true, data: true },
  });

  type Candidate = {
    orgId: string;
    userId: string;
    source: "report_task";
    category: "task_late";
    points: number;
    occurredAt: Date;
    refType: string;
    refId: string;
    note: string | null;
  };

  const candidates: Candidate[] = [];
  for (const row of tasks) {
    // ค่าเริ่มต้น = ยังเก็บคะแนนต่อบริษัทไว้ (ไม่เคยตั้งแถว performance_settings
    // มาก่อน) — ตรงกับ FALLBACK.enabled = true ใน lib/performance.ts
    if (enabledByOrg.get(row.orgId) === false) continue;

    const data = row.data as unknown as TaskDataShape;
    if (!data.missedDeadlineOnce || !data.penalties) continue;

    for (const [assigneeId, penalty] of Object.entries(data.penalties)) {
      if (!penalty || typeof penalty.points !== "number") continue;
      const appliedAt = new Date(penalty.appliedAt);
      candidates.push({
        orgId: row.orgId,
        userId: assigneeId,
        source: "report_task",
        category: "task_late",
        points: -Math.abs(penalty.points),
        occurredAt: Number.isNaN(appliedAt.getTime())
          ? data.dueDate
            ? new Date(data.dueDate)
            : new Date()
          : appliedAt,
        refType: "task",
        refId: `${row.id}:${assigneeId}`,
        note: data.title ?? null,
      });
    }
  }

  if (candidates.length === 0) {
    console.log("✔ ไม่มีเหตุการณ์ที่ขาดหาย — งานกลุ่มที่หักคะแนนแล้วทุกรายการมี performance_event ครบ");
    return;
  }

  // เช็คว่ามีอยู่แล้วหรือยัง (กันนับซ้ำในสรุป dry-run — ตอนเขียนจริง skipDuplicates
  // ก็กันซ้ำให้อีกชั้นอยู่แล้ว)
  const refIds = candidates.map((c) => c.refId);
  const existing = await prisma.performanceEvent.findMany({
    where: { source: "report_task", category: "task_late", refId: { in: refIds } },
    select: { orgId: true, refId: true },
  });
  const existingKey = new Set(existing.map((e) => `${e.orgId}:${e.refId}`));
  const missing = candidates.filter((c) => !existingKey.has(`${c.orgId}:${c.refId}`));

  if (missing.length === 0) {
    console.log("✔ ไม่มีเหตุการณ์ที่ขาดหาย — งานกลุ่มที่หักคะแนนแล้วทุกรายการมี performance_event ครบ");
    return;
  }

  const byOrg = new Map<string, number>();
  for (const c of missing) byOrg.set(c.orgId, (byOrg.get(c.orgId) ?? 0) + 1);
  console.log(`พบเหตุการณ์ที่ขาดหาย ${missing.length} รายการ ใน ${byOrg.size} บริษัท:`);
  for (const [orgId, count] of byOrg) console.log(`  ${orgId}  +${count}`);

  if (dryRun) {
    console.log("\n[dry-run] ยังไม่เขียนลงฐานข้อมูล — รันโดยไม่ใส่ --dry-run เพื่อเขียนจริง");
    return;
  }

  const { count } = await prisma.performanceEvent.createMany({
    data: missing.map((c) => ({
      orgId: c.orgId,
      userId: c.userId,
      source: c.source,
      category: c.category,
      points: new Prisma.Decimal(c.points),
      occurredAt: c.occurredAt,
      refType: c.refType,
      refId: c.refId,
      note: c.note,
    })),
    skipDuplicates: true,
  });
  console.log(`\n✔ เพิ่ม ${count} เหตุการณ์ — คะแนนรวมของคนที่เกี่ยวข้องจะอัปเดตทันทีที่โหลดหน้า /admin/performance ใหม่`);
}

main()
  .catch((err) => {
    console.error("[backfill-missing-group-task-late-events] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
