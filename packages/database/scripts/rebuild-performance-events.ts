import { PrismaClient, Prisma } from "@prisma/client";

/**
 * ลบคะแนนผลงานที่ระบบคำนวณทั้งหมด แล้วดึงข้อมูลต้นทางมาคำนวณใหม่ เริ่มนับตั้งแต่ --from
 *
 * ต่อบริษัทที่เปิดระบบคะแนนอยู่:
 *   1. ตั้ง "เริ่มนับคะแนนตั้งแต่วันที่" = --from — ระบบจะไม่บันทึก/ไม่นับอะไรก่อนวันนี้อีก
 *   2. ลบทุกเหตุการณ์ที่ระบบสร้าง (created_by ว่าง) ทุกวันที่ รวมรายการแก้ไขที่เคยออกไว้
 *   3. คำนวณใหม่ตั้งแต่ --from จากข้อมูลต้นทางปัจจุบัน:
 *        ขาดงาน/มาสาย     ← ผลลงเวลา (สแกนนิ้ว)
 *        ส่งงานเลยกำหนด   ← งานในบอร์ด
 *        ใบงานเกินกำหนด   ← วันครบกำหนด/วันปิดงาน/สถานะของใบงาน
 *        PM เกินกำหนด     ← รอบปัจจุบันที่ยังค้างอยู่เท่านั้น (ไม่มีประวัติรายรอบ)
 *
 * ไม่แตะ: ข้อมูลต้นทางทั้งหมด (สแกนนิ้ว งาน ใบงาน PM — อ่านอย่างเดียว) และเหตุการณ์ที่คน
 * สร้างเอง (created_by มีค่า = สติกเกอร์ของหัวหน้า) ทุกวันที่ — ก่อน --from เก็บไว้แต่ไม่ถูกนับ
 *
 * ผลลงเวลาอ่านจาก attendance_results ปัจจุบัน — เปิดหน้า /hr ก่อนรัน ให้ระบบคำนวณผลลงเวลา
 * 30 วันล่าสุดใหม่ (สคริปต์สั่งคำนวณเองไม่ได้ ต้องผ่าน workforce API ด้วย session)
 *
 * รัน (หลัง pnpm db:deploy และติดตั้ง 04-performance-lookup.sql รุ่นใหม่):
 *   set -a; . /etc/smartboss/smartboss.env; set +a
 *   pnpm --filter @smartboss/database exec tsx scripts/rebuild-performance-events.ts --from=2026-09-01 --dry-run
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const fromArg = process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length);

const DAY_MS = 86_400_000;
// ต้องตรงกับ DEFAULT_RULE_POINTS / ABSENCE_THRESHOLD_MINUTES ใน apps/web/lib/performance.ts
// (packages/database import จาก apps/web ไม่ได้)
const DEFAULT_POINTS: Record<string, number> = {
  attendance_late: -1,
  attendance_absent: -5,
  workorder_overdue: -3,
  pm_missed: -5,
};
const ABSENCE_THRESHOLD_MINUTES = 240;
const LABEL: Record<string, string> = {
  attendance_absent: "ขาดงาน",
  attendance_late: "มาสาย",
  task_late: "ส่งงานเลยกำหนด",
  task_manual_dock: "สติกเกอร์หัวหน้า",
  workorder_overdue: "ใบงานเกินกำหนด",
  pm_missed: "PM เกินกำหนด",
};
const REBUILT_ORDER = ["attendance_absent", "attendance_late", "task_late", "workorder_overdue", "pm_missed"];

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

/** รูปแบบเดียวกับ fmtThaiDate ใน apps/web/modules/maintenance/lib/format.ts */
function fmtThaiDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}

async function main() {
  if (!fromArg || !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) {
    throw new Error("ต้องระบุ --from=YYYY-MM-DD เช่น --from=2026-09-01");
  }
  const from = new Date(`${fromArg}T00:00:00Z`);
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
  const atLeastFrom = (d: Date) => (d > from ? d : from);

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
  const belongs = (userId: string | null | undefined, orgId: string): userId is string =>
    !!userId && userById.get(userId)?.orgId === orgId;

  function pointsFor(orgId: string, category: string): number {
    const overrides = (settingByOrg.get(orgId)?.rulePoints ?? {}) as Record<string, unknown>;
    const v = overrides[category];
    return typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_POINTS[category]!;
  }

  const events: Prisma.PerformanceEventCreateManyInput[] = [];

  // ── ขาดงาน/มาสาย: ผลลงเวลาปัจจุบัน ตั้งแต่ --from ถึงเมื่อวาน (วันที่ยังไม่จบไม่ตัดสิน) ──
  // ตรงกับ dockAttendance ใน apps/web/lib/attendance-performance.ts
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
    const st = settingByOrg.get(orgId);
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
    // สแกนแค่ครั้งเดียวนับเป็นขาดงานเฉพาะบริษัทที่ตั้งไว้ ไม่นับ = ไปเช็คมาสายต่อ
    const absent =
      absence > ABSENCE_THRESHOLD_MINUTES && (!r.missing_punch || (st?.missingPunchCountsAsAbsent ?? false));
    if (absent) {
      events.push({
        ...base,
        category: "attendance_absent",
        points: pointsFor(orgId, "attendance_absent"),
        note: `ขาดงาน ${Math.round(absence / 60)} ชั่วโมง`,
      });
    } else if (late > (st?.lateThresholdMinutes ?? 0)) {
      events.push({
        ...base,
        category: "attendance_late",
        points: pointsFor(orgId, "attendance_late"),
        note: `สาย ${late} นาที`,
      });
    }
  }

  // ── ส่งงานเลยกำหนด: สถานะงานปัจจุบัน — งานที่เจ้าของระบบยกเลิกการหักไปแล้วจะไม่ถูกนับ ──
  // ตรงกับ apps/web/app/api/report-task/tasks/sweep/route.ts
  const tasks = await prisma.reportTask.findMany({
    where: { orgId: { in: orgIds } },
    select: { id: true, orgId: true, data: true },
  });
  for (const t of tasks) {
    const d = t.data as unknown as TaskData;
    if (!d.missedDeadlineOnce) continue;
    const push = (userId: string | undefined, penalty: Penalty, when: Date | null, refId: string) => {
      if (!belongs(userId, t.orgId)) return;
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
      push(assigneeId, p, firstValidDate(d.assigneeDueDates?.[assigneeId], d.dueDate, p.appliedAt), `${t.id}:${assigneeId}`);
    }
  }

  // ── ใบงานเกินกำหนด: เลยวันครบกำหนด + ระยะผ่อนผัน ก่อนปิดงาน (ยังไม่ปิด = ถึงตอนนี้) ──
  // ตรงกับ dockOverdueMaintenance ใน apps/web/modules/maintenance/data/cron.ts
  // ช่วงที่ค้างต้องคาบเกี่ยว --from ขึ้นไป · ค้างมาตั้งแต่ก่อน --from ลงวันที่ --from
  const workOrders = await prisma.workOrder.findMany({
    where: { orgId: { in: orgIds }, dueDate: { not: null }, status: { not: "cancelled" } },
    select: {
      id: true,
      orgId: true,
      title: true,
      status: true,
      dueDate: true,
      completedAt: true,
      assignedTo: true,
      property: { select: { name: true, caretakerId: true } },
    },
  });
  for (const wo of workOrders) {
    const graceDays = settingByOrg.get(wo.orgId)?.workOrderGraceDays ?? 0;
    const overdueAt = new Date(wo.dueDate!.getTime() + graceDays * DAY_MS);
    const endedAt = wo.status === "completed" ? wo.completedAt : now;
    if (!endedAt || overdueAt >= endedAt || endedAt <= from) continue;
    const responsible = wo.assignedTo ?? wo.property?.caretakerId;
    if (!belongs(responsible, wo.orgId)) continue;
    events.push({
      orgId: wo.orgId,
      userId: responsible,
      source: "maintenance",
      category: "workorder_overdue",
      points: pointsFor(wo.orgId, "workorder_overdue"),
      occurredAt: atLeastFrom(overdueAt),
      refType: "work_order",
      refId: wo.id,
      note: `${wo.title}${wo.property?.name ? ` · ${wo.property.name}` : ""} · ครบกำหนด ${fmtThaiDate(wo.dueDate!)}`,
    });
  }

  // ── PM เกินกำหนด: รอบปัจจุบันที่เลยกำหนด + ระยะผ่อนผันแล้วยังค้างอยู่ ──
  // แผน PM เก็บแค่รอบปัจจุบัน รอบที่เคยเลยกำหนดแล้วทำเสร็จไปแล้วคำนวณย้อนไม่ได้
  const pms = await prisma.pmSchedule.findMany({
    where: { orgId: { in: orgIds }, isActive: true },
    select: {
      id: true,
      orgId: true,
      title: true,
      nextDueDate: true,
      assignedTo: true,
      property: { select: { name: true, caretakerId: true } },
    },
  });
  for (const pm of pms) {
    const graceDays = settingByOrg.get(pm.orgId)?.pmGraceDays ?? 7;
    const overdueAt = new Date(pm.nextDueDate.getTime() + graceDays * DAY_MS);
    if (overdueAt >= now) continue;
    const responsible = pm.assignedTo ?? pm.property?.caretakerId;
    if (!belongs(responsible, pm.orgId)) continue;
    events.push({
      orgId: pm.orgId,
      userId: responsible,
      source: "maintenance",
      category: "pm_missed",
      points: pointsFor(pm.orgId, "pm_missed"),
      occurredAt: atLeastFrom(overdueAt),
      refType: "pm_schedule",
      refId: `${pm.id}:${pm.nextDueDate.toISOString().slice(0, 10)}`,
      note: `${pm.title}${pm.property?.name ? ` · ${pm.property.name}` : ""} · ครบกำหนด ${fmtThaiDate(pm.nextDueDate)}`,
    });
  }

  // ── สรุปก่อนเขียน ──
  const inScope = { orgId: { in: orgIds } };
  const toDelete = await prisma.performanceEvent.groupBy({
    by: ["category"],
    where: { ...inScope, createdBy: null },
    _count: true,
  });
  const kept = await prisma.performanceEvent.groupBy({
    by: ["category"],
    where: { ...inScope, createdBy: { not: null } },
    _count: true,
  });

  const total = (gs: { _count: number }[]) => gs.reduce((s, g) => s + g._count, 0);
  const line = (g: { category: string; _count: number }) => `    ${LABEL[g.category] ?? g.category} ${g._count}`;
  const createdByCategory = new Map<string, number>();
  for (const e of events) createdByCategory.set(e.category, (createdByCategory.get(e.category) ?? 0) + 1);

  console.log(`เริ่มนับคะแนนตั้งแต่ ${fromArg} · ${scope.map((o) => o.name).join(", ")}\n`);
  console.log("ไม่แตะ: ข้อมูลสแกนนิ้ว งาน ใบงาน PM (อ่านอย่างเดียว)\n");
  console.log(`เก็บไว้ — คะแนนที่คนให้เอง: ${total(kept)} รายการ`);
  kept.forEach((g) => console.log(line(g)));
  console.log(`ลบ — คะแนนที่ระบบคำนวณ (ทุกวันที่): ${total(toDelete)} รายการ`);
  toDelete.forEach((g) => console.log(line(g)));
  console.log(`คำนวณใหม่ตั้งแต่ ${fromArg}: ${events.length} รายการ`);
  REBUILT_ORDER.forEach((c) => console.log(`    ${LABEL[c]} ${createdByCategory.get(c) ?? 0}`));
  console.log("\nรายคน:");

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
      const parts = REBUILT_ORDER.filter((c) => counts[c]).map((c) => `${LABEL[c]} ${counts[c]}`);
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
      await tx.performanceEvent.deleteMany({ where: { ...inScope, createdBy: null } });
      await tx.performanceEvent.createMany({ data: events, skipDuplicates: true });
    },
    { timeout: 120_000 },
  );
  console.log(`\n✔ ลบและคำนวณใหม่เรียบร้อย — เริ่มนับตั้งแต่ ${fromArg}`);
}

main()
  .catch((err) => {
    console.error("[rebuild-performance-events] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
