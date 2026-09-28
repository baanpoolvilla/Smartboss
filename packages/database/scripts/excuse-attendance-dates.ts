import { PrismaClient, Prisma } from "@prisma/client";

/**
 * ยกเว้นคะแนน "มาสาย/ขาดงาน" (ลงเวลา/สแกนนิ้ว) ของวันที่กำหนด — สำหรับวันที่
 * บริษัทประกาศว่าไม่ต้องลงเวลา แต่ยังเป็นวันทำงาน (เช่น น้ำท่วม/Work From Home
 * 26–27/09/2026) **รายงานยังนับตามปกติ** สคริปต์นี้แตะแค่ attendance_late /
 * attendance_absent ของ source "workforce" ไม่แตะ report_* หรือหมวดอื่นเลย
 *
 * ทำไมไม่ใส่เป็นวันหยุดในปฏิทิน HR: วันหยุดบริษัทจะยกเว้นการส่งรายงานด้วย
 * (report-feed-exemptions.ts companyDates) และอาจมีผลกับการคิดเงินวันหยุด
 *
 * วิธีแก้: ออกเหตุการณ์ "แก้ไข" หักล้างของเดิมพอดี (refType
 * attendance_day_correction, refId = id ของเหตุการณ์เดิม — แบบเดียวกับ
 * reconcile-wrong-attendance-events.ts) ไม่ลบของเดิม ประวัติ audit ครบ
 * - ของเดิมยังอยู่ ⇒ cron dockAttendance บันทึกซ้ำไม่ได้ (unique key) ไม่เด้งกลับ
 * - unique key เดียวกับสคริปต์ reconcile ⇒ รันซ้ำ/รันทั้งสองตัวไม่คืนแต้มซ้ำ
 * - cron อาจยังไม่ได้เก็บวันล่าสุด (รอวันจบก่อน) — รันซ้ำอีกครั้งวันถัดไปได้เลย
 *
 * รัน (บนเซิร์ฟเวอร์ source env ก่อนเหมือนตอนรัน db:deploy):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/excuse-attendance-dates.ts \
 *     --dates=2026-09-26,2026-09-27 --dry-run
 *   ตัด --dry-run ออกเพื่อเขียนจริง · เติม --org=<orgId> เพื่อจำกัดบริษัทเดียว
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const dates = (arg("dates") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  if (dates.length === 0 || dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    console.error("ต้องระบุ --dates=YYYY-MM-DD[,YYYY-MM-DD...]");
    process.exitCode = 1;
    return;
  }
  const orgId = arg("org");

  // occurredAt ของเหตุการณ์ลงเวลา = new Date(work_date) = เที่ยงคืน UTC ของวันนั้น
  // (ดู apps/web/lib/attendance-performance.ts) จึงเทียบแบบวัน UTC ได้ตรง ๆ
  const originals = await prisma.performanceEvent.findMany({
    where: {
      source: "workforce",
      category: { in: ["attendance_late", "attendance_absent"] },
      refType: "attendance_day",
      ...(orgId ? { orgId } : {}),
      OR: dates.map((d) => ({
        occurredAt: { gte: new Date(`${d}T00:00:00.000Z`), lt: new Date(`${d}T23:59:59.999Z`) },
      })),
    },
    orderBy: [{ occurredAt: "asc" }, { userId: "asc" }],
  });

  if (originals.length === 0) {
    console.log(`ไม่มีคะแนนมาสาย/ขาดงานของวันที่ ${dates.join(", ")} ให้ยกเว้น`);
    return;
  }

  // ข้ามอันที่แก้ไปแล้ว (จากสคริปต์นี้หรือ reconcile) — แค่ให้รายงานตรง ถึงไม่ข้าม
  // createMany ก็ skipDuplicates อยู่แล้ว
  const already = await prisma.performanceEvent.findMany({
    where: {
      source: "workforce",
      refType: "attendance_day_correction",
      refId: { in: originals.map((o) => o.id) },
    },
    select: { refId: true },
  });
  const alreadyIds = new Set(already.map((a) => a.refId));
  const todo = originals.filter((o) => !alreadyIds.has(o.id));

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(originals.map((o) => o.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const label = (c: string) => (c === "attendance_absent" ? "ขาดงาน" : "มาสาย");
  console.log(`พบ ${originals.length} รายการ · แก้ไปแล้ว ${alreadyIds.size} · จะคืนคะแนน ${todo.length}\n`);
  for (const o of todo) {
    const day = o.occurredAt.toISOString().slice(0, 10);
    console.log(`  ${day}  ${nameById.get(o.userId) ?? o.userId}  ${label(o.category)} ${Number(o.points)} → คืน`);
  }

  if (todo.length === 0) return;
  if (dryRun) {
    console.log("\n[dry-run] ยังไม่เขียนลงฐานข้อมูล — รันโดยไม่ใส่ --dry-run เพื่อคืนคะแนนจริง");
    return;
  }

  const { count } = await prisma.performanceEvent.createMany({
    data: todo.map((o) => ({
      orgId: o.orgId,
      userId: o.userId,
      source: o.source,
      category: o.category,
      points: new Prisma.Decimal(Number(o.points) * -1),
      // วันเดียวกับเหตุการณ์เดิม — ไม่งั้นแต้มที่คืนไปโผล่ผิดเดือน (ดู reconcile)
      occurredAt: o.occurredAt,
      refType: "attendance_day_correction",
      refId: o.id,
      note: `ยกเว้นการลงเวลาวันที่ ${o.occurredAt.toISOString().slice(0, 10)} (บริษัทประกาศไม่ต้องลงเวลา)`,
    })),
    skipDuplicates: true,
  });
  console.log(`\n✔ คืนคะแนน ${count} รายการ — คะแนนรวมอัปเดตทันทีที่โหลดหน้าคะแนนใหม่`);
}

main()
  .catch((err) => {
    console.error("[excuse-attendance-dates] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
