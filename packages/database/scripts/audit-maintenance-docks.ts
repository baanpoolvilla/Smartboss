import { PrismaClient } from "@prisma/client";

/**
 * อ่านอย่างเดียว — ไล่คะแนนหักจากงานซ่อมบำรุงของทุกคน (workorder_overdue "ใบงานเกินกำหนด"
 * และ pm_missed "ไม่ทำบำรุงรักษาตามรอบ") แล้วชี้รายการที่น่าจะซ้ำหรือไม่ควรค้าง:
 *
 *   ⚠ ซ้อน    ใบงานที่ผูกกับ PM ถูกหัก "ใบงานเกินกำหนด" และ PM เดียวกันถูกหัก "ไม่ทำตามรอบ" ด้วย
 *   ⚠ ย้ายคน   คนที่ถูกหักไม่ใช่ผู้รับผิดชอบคนปัจจุบันแล้ว
 *   ⚠ เลื่อน    กำหนดส่งตอนนี้ช้ากว่าวันที่ถูกหัก (เลื่อนหลังโดนหัก)
 *   ⚠ ปิดแล้ว   ใบงานปิดแล้ว/ยกเลิก (ข้อมูลประกอบ — หักตอนยังค้างอยู่ถูกแล้ว)
 *   ⚠ PM ปิด   แผน PM ถูกปิดใช้งานไปแล้ว
 *
 * รัน:
 *   sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; \
 *     pnpm --filter @smartboss/database exec tsx scripts/audit-maintenance-docks.ts [--days=45]'
 */

const prisma = new PrismaClient();

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

const day = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d) : "-";

async function main() {
  const days = Number(arg("days", "45"));
  const since = new Date(Date.now() - days * 86_400_000);

  const events = await prisma.performanceEvent.findMany({
    where: { source: "maintenance", occurredAt: { gte: since } },
    orderBy: [{ userId: "asc" }, { occurredAt: "asc" }],
  });
  if (events.length === 0) {
    console.log(`ไม่มีคะแนนหักจากงานซ่อมบำรุงใน ${days} วันที่ผ่านมา`);
    return;
  }

  const userIds = [...new Set(events.map((e) => e.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const woIds = events.filter((e) => e.category === "workorder_overdue" && e.refId).map((e) => e.refId!);
  const pmIds = events.filter((e) => e.category === "pm_missed" && e.refId).map((e) => e.refId!.split(":")[0]!);
  const wos = await prisma.workOrder.findMany({
    where: { id: { in: woIds } },
    select: {
      id: true, code: true, title: true, status: true, dueDate: true, completedAt: true,
      assignedTo: true, pmScheduleId: true, pmScheduleIds: true, autoCreated: true,
      property: { select: { name: true, caretakerId: true } },
    },
  });
  const pms = await prisma.pmSchedule.findMany({
    where: { id: { in: pmIds } },
    select: { id: true, title: true, nextDueDate: true, isActive: true, assignedTo: true, frequency: true, property: { select: { name: true, caretakerId: true } } },
  });
  const woById = new Map(wos.map((w) => [w.id, w]));
  const pmById = new Map(pms.map((p) => [p.id, p]));

  // PM ที่ถูกหัก "ไม่ทำตามรอบ" ต่อคน — ไว้จับซ้อนกับใบงานที่ผูก PM เดียวกัน
  const pmDockedBy = new Set(
    events.filter((e) => e.category === "pm_missed" && e.refId).map((e) => `${e.userId}|${e.refId!.split(":")[0]}`),
  );

  const perUser = new Map<string, { wo: number; pm: number; points: number }>();
  const flagged: string[] = [];
  const pmRounds = new Map<string, number>();

  for (const e of events) {
    const who = nameOf.get(e.userId) ?? e.userId;
    const agg = perUser.get(who) ?? { wo: 0, pm: 0, points: 0 };
    agg.points += Number(e.points);
    const flags: string[] = [];
    let label = e.note ?? "";

    if (e.category === "workorder_overdue") {
      agg.wo++;
      const wo = e.refId ? woById.get(e.refId) : undefined;
      if (!wo) {
        flags.push("ใบงานถูกลบไปแล้ว");
      } else {
        label = `${wo.code} ${wo.title} · ${wo.property?.name ?? ""} · ครบ ${day(wo.dueDate)} · ${wo.status}${wo.autoCreated ? " · สร้างจาก PM อัตโนมัติ" : ""}`;
        const responsible = wo.assignedTo ?? wo.property?.caretakerId;
        if (responsible && responsible !== e.userId) flags.push(`ย้ายคน (ตอนนี้: ${nameOf.get(responsible) ?? responsible})`);
        if (wo.dueDate && day(wo.dueDate) >= day(e.occurredAt)) flags.push(`เลื่อนกำหนดหลังโดนหัก (หัก ${day(e.occurredAt)})`);
        if (wo.status === "completed" || wo.status === "cancelled") flags.push(`ปิดแล้ว ${day(wo.completedAt)}`);
        const linkedPms = [wo.pmScheduleId, ...(wo.pmScheduleIds ?? [])].filter((x): x is string => !!x);
        if (linkedPms.some((p) => pmDockedBy.has(`${e.userId}|${p}`))) flags.push("ซ้อน: PM เดียวกันถูกหัก ไม่ทำตามรอบ ด้วย");
      }
    } else if (e.category === "pm_missed") {
      agg.pm++;
      const pmId = e.refId?.split(":")[0];
      const round = e.refId?.split(":")[1] ?? "-";
      const pm = pmId ? pmById.get(pmId) : undefined;
      if (pmId) pmRounds.set(`${who}|${pmId}`, (pmRounds.get(`${who}|${pmId}`) ?? 0) + 1);
      if (!pm) {
        flags.push("แผน PM ถูกลบไปแล้ว");
      } else {
        label = `PM ${pm.title} · ${pm.property?.name ?? ""} · รอบ ${round} · ตอนนี้ครบ ${day(pm.nextDueDate)} (${pm.frequency})`;
        const responsible = pm.assignedTo ?? pm.property?.caretakerId;
        if (responsible && responsible !== e.userId) flags.push(`ย้ายคน (ตอนนี้: ${nameOf.get(responsible) ?? responsible})`);
        if (!pm.isActive) flags.push("PM ถูกปิดใช้งานแล้ว");
      }
    }
    perUser.set(who, agg);
    if (flags.length > 0) flagged.push(`  ${day(e.occurredAt)}  ${who}  ${e.category === "pm_missed" ? "ไม่ทำตามรอบ" : "ใบงานเกินกำหนด"} ${Number(e.points)}  ${label}\n      → ${flags.join(" · ")}`);
  }

  console.log(`\nคะแนนหักจากงานซ่อมบำรุง ${days} วันที่ผ่านมา (${events.length} รายการ)`);
  for (const [who, a] of perUser) console.log(`  ${who}: ใบงานเกินกำหนด ${a.wo} · ไม่ทำตามรอบ ${a.pm} · รวม ${a.points}`);

  const repeatedPm = [...pmRounds].filter(([, n]) => n > 1);
  if (repeatedPm.length > 0) {
    console.log("\nPM เดียวกันถูกหักหลายรอบ (ค้างข้ามหลายรอบ หรือรอบไม่ขยับหลังปิดงาน):");
    for (const [key, n] of repeatedPm) {
      const [who, pmId] = key.split("|");
      console.log(`  ${who}  ${pmById.get(pmId!)?.title ?? pmId}  ${n} รอบ`);
    }
  }

  console.log(`\nรายการที่ควรดู: ${flagged.length}`);
  for (const line of flagged) console.log(line);
}

main()
  .catch((err) => {
    console.error("[audit-maintenance-docks] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
