import { prisma } from "@smartboss/database";
import { notifyDuePmSchedules } from "@/modules/maintenance/data/cron";
(async () => {
  const wo = await prisma.workOrder.findFirst({ where: { code: { startsWith: "WO-" }, title: { startsWith: "PMRND D" } }, select: { id: true, orgId: true, status: true, dueDate: true, pmRoundDate: true, overdueScore: true, assignedTo: true } });
  console.log(wo);
  console.log(await prisma.notification.findMany({ where: { orgId: wo!.orgId, referenceId: wo!.id }, select: { title: true, userId: true, createdAt: true } }));
  console.log(await notifyDuePmSchedules());
  console.log(await prisma.notification.findMany({ where: { orgId: wo!.orgId, referenceId: wo!.id }, select: { title: true, userId: true } }));
  process.exit(0);
})();
