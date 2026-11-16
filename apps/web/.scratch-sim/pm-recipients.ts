import { prisma } from "@smartboss/database";
import { generateWorkOrdersForDuePms, notifyDuePmSchedules } from "@/modules/maintenance/data/cron";
(async () => {
  const { orgId } = await prisma.user.findUniqueOrThrow({ where: { id: "t-admin" }, select: { orgId: true } });
  const prop = await prisma.property.findFirstOrThrow({ where: { orgId, archivedAt: null } });
  const oldCare = prop.caretakerId;
  await prisma.property.update({ where: { id: prop.id }, data: { caretakerId: "t-caretaker" } });
  await prisma.performanceSetting.upsert({ where: { orgId }, create: { orgId, pmRoundsFrom: new Date("2026-10-25T00:00:00Z") }, update: { pmRoundsFrom: new Date("2026-10-25T00:00:00Z") } });
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  // ใบรอบ (เลยกำหนด 1 พ.ย.) + แผนนับครั้ง (แบบเดิม) ที่เลยกำหนด — มี CC ทั้งคู่
  const round = await prisma.pmSchedule.create({ data: { orgId, propertyId: prop.id, title: "RCPT รอบ", frequency: "monthly", nextDueDate: d("2026-11-01"), anchorDate: d("2026-11-01"), assignedTo: "t-ton", createdBy: "t-admin", ccUserIds: ["t-hr"] } });
  const legacy = await prisma.pmSchedule.create({ data: { orgId, propertyId: prop.id, title: "RCPT นับครั้ง", frequency: "monthly", nextDueDate: d("2026-11-01"), totalRounds: 3, assignedTo: "t-ton", createdBy: "t-admin", ccUserIds: ["t-hr"] } });
  try {
    await generateWorkOrdersForDuePms();
    await notifyDuePmSchedules();
    const wos = (await prisma.workOrder.findMany({ where: { orgId, pmScheduleId: { in: [round.id, legacy.id] } }, select: { id: true } })).map((w) => w.id);
    const ns = await prisma.notification.findMany({ where: { orgId, referenceId: { in: [...wos, round.id, legacy.id] } }, select: { userId: true, title: true } });
    const others = ns.filter((n) => n.userId !== "t-ton");
    console.log(others.length === 0 && ns.length >= 2 ? `PASS | แจ้งเตือน PM ${ns.length} อัน ไปที่ผู้รับผิดชอบคนเดียว (CC/ผู้ดูแลบ้านไม่ได้)` : `FAIL | ${JSON.stringify(ns)}`);
    await prisma.notification.deleteMany({ where: { orgId, referenceId: { in: [...wos, round.id, legacy.id] } } });
    await prisma.chatMessage.deleteMany({ where: { orgId, clientId: { in: wos.map((i) => `wo-${i}`) } } });
    await prisma.workOrder.deleteMany({ where: { orgId, id: { in: wos } } });
  } finally {
    await prisma.pmSchedule.deleteMany({ where: { orgId, id: { in: [round.id, legacy.id] } } });
    await prisma.property.update({ where: { id: prop.id }, data: { caretakerId: oldCare } });
    await prisma.performanceSetting.deleteMany({ where: { orgId } });
  }
  process.exit(0);
})();
