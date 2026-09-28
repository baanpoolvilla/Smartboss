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

  await auditPmWorkOrders(since);
}

/** ใบงาน PM ซ้อน (เปิดค้างหลายใบพร้อมกัน) และรอบที่ห่างกันสั้นกว่าความถี่ของ PM */
async function auditPmWorkOrders(since: Date) {
  const cycleDays: Record<string, number> = { weekly: 7, biweekly: 14, triweekly: 21 };
  const monthsOf: Record<string, number> = {
    monthly: 1, bimonthly: 2, quarterly: 3, month4: 4, month5: 5, semiannual: 6,
    month7: 7, month8: 8, month9: 9, month10: 10, month11: 11, annual: 12,
  };
  const wos = await prisma.workOrder.findMany({
    where: { OR: [{ pmScheduleId: { not: null } }, { pmScheduleIds: { isEmpty: false } }], createdAt: { gte: since } },
    select: { code: true, status: true, createdAt: true, autoCreated: true, pmScheduleId: true, pmScheduleIds: true },
    orderBy: { createdAt: "asc" },
  });
  const byPm = new Map<string, typeof wos>();
  for (const w of wos) {
    for (const id of new Set([...(w.pmScheduleId ? [w.pmScheduleId] : []), ...w.pmScheduleIds])) {
      byPm.set(id, [...(byPm.get(id) ?? []), w]);
    }
  }
  const pms = await prisma.pmSchedule.findMany({
    where: { id: { in: [...byPm.keys()] } },
    select: { id: true, title: true, frequency: true, property: { select: { name: true } } },
  });

  const overlap: string[] = [];
  const tooSoon: string[] = [];
  for (const pm of pms) {
    const list = byPm.get(pm.id) ?? [];
    const label = `${pm.title} · ${pm.property?.name ?? ""} (${pm.frequency})`;
    const open = list.filter((w) => w.status === "open" || w.status === "in_progress");
    if (open.length > 1) overlap.push(`  ${label}: ${open.map((w) => `${w.code}${w.autoCreated ? "[อัตโนมัติ]" : ""}`).join(", ")}`);
    const minDays = cycleDays[pm.frequency] ?? (monthsOf[pm.frequency] ?? 1) * 28;
    const live = list.filter((w) => w.status !== "cancelled");
    for (let i = 1; i < live.length; i++) {
      const gap = Math.round((live[i]!.createdAt.getTime() - live[i - 1]!.createdAt.getTime()) / 86_400_000);
      if (gap < minDays) tooSoon.push(`  ${label}: ${live[i - 1]!.code} → ${live[i]!.code} ห่าง ${gap} วัน (รอบ ${minDays})`);
    }
  }
  // แผน PM ซ้ำ: บ้าน/อุปกรณ์เดียวกัน ชื่อเดียวกัน ยังใช้งานอยู่ทั้งคู่ — ต่างคนต่างเปิดใบงาน
  const active = await prisma.pmSchedule.findMany({
    where: { isActive: true },
    select: { id: true, title: true, propertyId: true, assetId: true, frequency: true, nextDueDate: true, createdAt: true, property: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const groups = new Map<string, typeof active>();
  for (const p of active) {
    const key = `${p.propertyId}|${p.assetId ?? "-"}|${p.title.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const dupPms = [...groups.values()].filter((g) => g.length > 1);
  console.log(`\nแผน PM ซ้ำ (บ้าน/อุปกรณ์/ชื่อเดียวกัน ยังใช้งานทั้งคู่): ${dupPms.length} กลุ่ม`);
  for (const g of dupPms) {
    console.log(`  ${g[0]!.title} · ${g[0]!.property?.name ?? ""}: ${g.map((p) => `${p.id.slice(0, 8)} (${p.frequency}, ครบ ${p.nextDueDate.toISOString().slice(0, 10)}, สร้าง ${p.createdAt.toISOString().slice(0, 10)})`).join(" / ")}`);
  }

  console.log(`\nPM ที่มีใบงานเปิดซ้อนกันตอนนี้: ${overlap.length}`);
  for (const l of overlap) console.log(l);
  console.log(`\nใบงาน PM ที่เปิดเร็วกว่ารอบ: ${tooSoon.length}`);
  for (const l of tooSoon) console.log(l);
}

main()
  .catch((err) => {
    console.error("[audit-maintenance-docks] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
