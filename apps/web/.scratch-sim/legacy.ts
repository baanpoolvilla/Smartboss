import { prisma } from "@smartboss/database";
import { generateWorkOrdersForDuePms } from "@/modules/maintenance/data/cron";
import { completePmSchedule } from "@/modules/maintenance/data/pm";
(async () => {
  const { orgId } = await prisma.user.findUniqueOrThrow({ where: { id: "t-admin" }, select: { orgId: true } });
  await prisma.performanceSetting.deleteMany({ where: { orgId } });
  const prop = await prisma.property.findFirstOrThrow({ where: { orgId, archivedAt: null }, select: { id: true } });
  const pm = await prisma.pmSchedule.create({ data: { orgId, propertyId: prop.id, title: "PMRND LEGACY", frequency: "monthly", nextDueDate: new Date("2026-11-01T00:00:00Z"), assignedTo: "t-ton" } });
  await generateWorkOrdersForDuePms();
  const wos = await prisma.workOrder.findMany({ where: { orgId, pmScheduleId: pm.id } });
  console.log((wos.length === 1 && !wos[0]!.pmRoundDate && !wos[0]!.dueDate) ? "PASS | แบบเดิม: เปิดใบวันครบกำหนด ไม่มีรอบ ไม่มีกำหนดส่ง" : "FAIL | legacy open", wos.length);
  await completePmSchedule(orgId, pm.id);
  const after = await prisma.pmSchedule.findUniqueOrThrow({ where: { id: pm.id } });
  console.log(after.nextDueDate.toISOString().slice(0, 10) === "2026-12-02" ? "PASS | แบบเดิม: ปิดช้า รอบถัดไปนับจากวันปิด (2 ธ.ค.)" : "FAIL | legacy advance " + after.nextDueDate.toISOString());
  await prisma.workOrder.deleteMany({ where: { orgId, pmScheduleId: pm.id } });
  await prisma.pmSchedule.deleteMany({ where: { orgId, id: pm.id } });
  process.exit(0);
})();
