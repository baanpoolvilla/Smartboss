import { prisma } from "@smartboss/database";
import { generateWorkOrdersForDuePms } from "@/modules/maintenance/data/cron";
(async () => {
  const prop = await prisma.property.findFirst({ where: { archivedAt: null } });
  if (!prop) throw new Error("no property");
  const ids = ["pm-autoexp-f", "pm-autoexp-t"];
  const base = { orgId: prop.orgId, propertyId: prop.id, frequency: "monthly", assignedTo: "t-ton", createdBy: "t-admin", nextDueDate: new Date(Date.now() - 86400000) };
  try {
    await prisma.pmSchedule.create({ data: { ...base, id: ids[0], title: "ทดสอบออโต้ วัดค่าน้ำ (ไม่มีค่าใช้จ่าย)", requiresExpense: false } });
    await prisma.pmSchedule.create({ data: { ...base, id: ids[1], title: "ทดสอบออโต้ ล้างแอร์ (มีค่าใช้จ่าย)", requiresExpense: true } });
    console.log("run:", await generateWorkOrdersForDuePms());
    const wos = await prisma.workOrder.findMany({ where: { pmScheduleId: { in: ids } }, select: { code: true, title: true, autoCreated: true, requiresExpense: true } });
    for (const w of wos) console.log(w.code, "|", w.title, "| auto:", w.autoCreated, "| requiresExpense:", w.requiresExpense);
  } finally {
    await prisma.activityLog?.deleteMany?.({ where: { targetId: { in: (await prisma.workOrder.findMany({ where: { pmScheduleId: { in: ids } }, select: { id: true } })).map((w) => w.id) } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { pmScheduleId: { in: ids } } });
    await prisma.pmSchedule.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
})();
