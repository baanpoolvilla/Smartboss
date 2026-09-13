import { PrismaClient, Prisma } from "@prisma/client";

/**
 * ล้างคะแนนผลงานที่ระบบคำนวณไว้ แล้วคำนวณใหม่ทั้งหมด เริ่มนับตั้งแต่วันที่กำหนด
 *
 * ต่อบริษัทที่เปิดระบบคะแนนอยู่:
 *   1. ตั้ง "เริ่มนับคะแนนตั้งแต่วันที่" = --from — cron ทุกตัวจะไม่บันทึกอะไรก่อนวันนี้อีก
 *   2. ลบทุกเหตุการณ์ก่อน --from
 *   3. ตั้งแต่ --from: ลบเหตุการณ์ที่สร้างคืนจากต้นทางได้ (มาสาย/ขาดงาน/ส่งงานเลยกำหนด
 *      รวมรายการแก้ไขที่สคริปต์ reconcile เคยออกไว้) แล้วสร้างใหม่จากข้อมูลปัจจุบัน
 *
 * ไม่แตะ (ตั้งแต่ --from): สติกเกอร์ที่หัวหน้ากดเอง (คนตัดสิน สร้างคืนไม่ได้) และใบงาน/PM
 * เกินกำหนด (บันทึกวันที่ตรวจพบไว้ ใบงานที่ปิดไปแล้วสร้างประวัติคืนไม่ได้)
 *
 * ผลลงเวลาอ่านจาก attendance_results ปัจจุบัน — เปิดหน้า /hr ก่อนรัน ให้ระบบคำนวณผลลงเวลา
 * 30 วันล่าสุดใหม่ (สคริปต์สั่งคำนวณเองไม่ได้ ต้องผ่าน workforce API ด้วย session)
 *
 * รัน (หลัง pnpm db:deploy):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/rebuild-performance-events.ts --from=2026-09-01 --dry-run
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const fromArg = process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length);

// ต้องตรงกับ DEFAULT_RULE_POINTS / ABSENCE_THRESHOLD_MINUTES ใน apps/web/lib/performance.ts
// (packages/database import จาก apps/web ไม่ได้)
const DEFAULT_POINTS: Record<string, number> = { attendance_late: -1, attendance_absent: -5 };
const ABSENCE_THRESHOLD_MINUTES = 240;
const REBUILDABLE = ["attendance_late", "attendance_absent", "task_late"];
const LABEL: Record<string, string> = {
  attendance_absent: "ขาดงาน",
  attendance_late: "มาสาย",
  task_late: "ส่งงานเลยกำหนด",
  task_manual_dock: "หักคะแนนโดยหัวหน้า",
  workorder_overdue: "ใบงานเกินกำหนด",
  pm_missed: "ไม่ทำบำรุงรักษาตามรอบ",
};

interface AttendanceRow {
  subject: string;
  work_date: Date;
  late_minutes: number;
  absence_minutes: number;
  missing_punch: boolean;
}
interface Penalty {
  points: number;
  appliedAt?: string;
}
interface TaskData {
  title?: string;
  missedDeadlineOnce?: boolean;
  dueDate?: string;
  assigneeIds?: string[];
  assigneeDueDates?: Record<string, string>;
  penalty?: Penalty | null;
  penalties?: Record<string, Penalty>;
}

function firstValidDate(...values: (string | undefined)[]): Date | null {
  for (const v of values) {
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

async function main() {
  if (!fromArg || !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) {
    throw new Error("ต้องระบุ --from=YYYY-MM-DD เช่น --from=2026-09-01");
  }
  const from = new Date(`${fromArg}T00:00:00Z`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const settingByOrg = new Map((await prisma.performanceSetting.findMany()).map((s) => [s.orgId, s]));
  const scope = orgs.filter((o) => settingByOrg.get(o.id)?.enabled !== false);
  if (scope.length === 0) {
    console.log("ไม่มีบริษัทที่เปิดระบบคะแนนอยู่");
    return;
  }
  const orgIds = scope.map((o) => o.id);

  const users = await prisma.user.findMany({
    where: { orgId: { in: orgIds } },
    select: { id: true, orgId: true, name: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  function pointsFor(orgId: string, category: string): number {
    const overrides = (settingByOrg.get(orgId)?.rulePoints ?? {}) as Record<string, unknown>;
    const v = overrides[category];
    return typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_POINTS[category]!;
  }

  const events: Prisma.PerformanceEventCreateManyInput[] = [];

  // ── มาสาย/ขาดงาน: ผลลงเวลาปัจจุบัน ตั้งแต่ --from ถึงเมื่อวาน (วันที่ยังไม่จบไม่ตัดสิน) ──
  const rows = await prisma.$queryRaw<AttendanceRow[]>`
    SELECT subject, work_date, late_minutes, absence_minutes, missing_punch
    FROM workforce.performance_attendance(${from}::date, -1::int, -1::int)
  `;
  for (const r of rows) {
    const day = new Date(r.work_date).toISOString().slice(0, 10);
    if (day < fromArg || day >= today) continue;
    const user = userById.get(r.subject);
    if (!user?.orgId) continue;
    const orgId = user.orgId;
    const late = Number(r.late_minutes);
    const absence = Number(r.absence_minutes);
    const base = {
      orgId,
      userId: user.id,
      source: "workforce",
      occurredAt: new Date(r.work_date),
      refType: "attendance_day",
      refId: `${user.id}:${day}`,
    };
    // ตรงกับ dockAttendance: สแกนแค่ครั้งเดียวนับเป็นขาดงานเฉพาะบริษัทที่ตั้งไว้
    const absent =
      absence > ABSENCE_THRESHOLD_MINUTES &&
      (!r.missing_punch || (settingByOrg.get(orgId)?.missingPunchCountsAsAbsent ?? false));
    if (absent) {
      events.push({
        ...base,
        category: "attendance_absent",
        points: pointsFor(orgId, "attendance_absent"),
        note: `ขาดงาน ${Math.round(absence / 60)} ชั่วโมง`,
      });
    } else if (late > (settingByOrg.get(orgId)?.lateThresholdMinutes ?? 0)) {
      events.push({
        ...base,
        category: "attendance_late",
        points: pointsFor(orgId, "attendance_late"),
        note: `สาย ${late} นาที`,
      });
    }
  }

  // ── ส่งงานเลยกำหนด: สถานะงานปัจจุบัน — งานที่เจ้าของระบบยกเลิกการหักไปแล้วจะไม่ถูกนับ ──
  // occurredAt/refId ตรงกับ apps/web/app/api/report-task/tasks/sweep/route.ts
  const tasks = await prisma.reportTask.findMany({
    where: { orgId: { in: orgIds } },
    select: { id: true, orgId: true, data: true },
  });
  for (const t of tasks) {
    const d = t.data as unknown as TaskData;
    if (!d.missedDeadlineOnce) continue;
    const push = (userId: string | undefined, penalty: Penalty, when: Date | null, refId: string) => {
      if (!userId || userById.get(userId)?.orgId !== t.orgId) return;
      if (typeof penalty.points !== "number" || !when || when < from) return;
      events.push({
        orgId: t.orgId,
        userId,
        source: "report_task",
        category: "task_late",
        points: -Math.abs(penalty.points),
        occurredAt: when,
        refType: "task",
        refId,
        note: d.title ?? null,
      });
    };
    if (d.penalty) push(d.assigneeIds?.[0], d.penalty, firstValidDate(d.dueDate, d.penalty.appliedAt), t.id);
    for (const [assigneeId, p] of Object.entries(d.penalties ?? {})) {
      push(
        assigneeId,
        p,
        firstValidDate(d.assigneeDueDates?.[assigneeId], d.dueDate, p.appliedAt),
        `${t.id}:${assigneeId}`,
      );
    }
  }

  // ── สรุปก่อนเขียน ──
  const inScope = { orgId: { in: orgIds } };
  const before = await prisma.performanceEvent.groupBy({
    by: ["category"],
    where: { ...inScope, occurredAt: { lt: from } },
    _count: true,
  });
  const toRebuild = await prisma.performanceEvent.count({
    where: { ...inScope, occurredAt: { gte: from }, category: { in: REBUILDABLE } },
  });
  const kept = await prisma.performanceEvent.groupBy({
    by: ["category"],
    where: { ...inScope, occurredAt: { gte: from }, category: { notIn: REBUILDABLE } },
    _count: true,
  });

  const line = (g: { category: string; _count: number }) => `    ${LABEL[g.category] ?? g.category} ${g._count}`;
  console.log(`เริ่มนับคะแนนตั้งแต่ ${fromArg} · ${scope.map((o) => o.name).join(", ")}\n`);
  console.log(`ลบทิ้ง — เหตุการณ์ก่อน ${fromArg}: ${before.reduce((s, g) => s + g._count, 0)} รายการ`);
  before.forEach((g) => console.log(line(g)));
  console.log(`ลบเพื่อคำนวณใหม่ — มาสาย/ขาดงาน/ส่งงานเลยกำหนด ตั้งแต่ ${fromArg}: ${toRebuild} รายการ`);
  console.log(`เก็บไว้ตามเดิม — ตั้งแต่ ${fromArg}: ${kept.reduce((s, g) => s + g._count, 0)} รายการ`);
  kept.forEach((g) => console.log(line(g)));
  console.log(`\nสร้างใหม่: ${events.length} รายการ\n`);

  const perUser = new Map<string, Record<string, number>>();
  for (const e of events) {
    const counts = perUser.get(e.userId) ?? {};
    counts[e.category] = (counts[e.category] ?? 0) + 1;
    perUser.set(e.userId, counts);
  }
  [...perUser.entries()]
    .map(([id, counts]) => ({ name: userById.get(id)?.name ?? id, counts }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ name, counts }) => {
      const parts = REBUILDABLE.filter((c) => counts[c]).map((c) => `${LABEL[c]} ${counts[c]}`);
      console.log(`  ${name.padEnd(32)} ${parts.join(" · ")}`);
    });

  if (dryRun) {
    console.log("\n[dry-run] ยังไม่เขียนลงฐานข้อมูล — รันโดยไม่ใส่ --dry-run เพื่อทำจริง");
    return;
  }

  // ลบกับสร้างใหม่ต้องสำเร็จพร้อมกัน — ล้มกลางทางแล้วค้างสภาพ "ลบแล้วยังไม่ได้สร้าง" ไม่ได้
  await prisma.$transaction(
    async (tx) => {
      for (const o of scope) {
        await tx.performanceSetting.upsert({
          where: { orgId: o.id },
          update: { scoringStartDate: from },
          create: { orgId: o.id, scoringStartDate: from },
        });
      }
      await tx.performanceEvent.deleteMany({ where: { ...inScope, occurredAt: { lt: from } } });
      await tx.performanceEvent.deleteMany({
        where: { ...inScope, occurredAt: { gte: from }, category: { in: REBUILDABLE } },
      });
      await tx.performanceEvent.createMany({ data: events, skipDuplicates: true });
    },
    { timeout: 120_000 },
  );
  console.log(`\n✔ ล้างและคำนวณใหม่เรียบร้อย — เริ่มนับตั้งแต่ ${fromArg}`);
}

main()
  .catch((err) => {
    console.error("[rebuild-performance-events] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
