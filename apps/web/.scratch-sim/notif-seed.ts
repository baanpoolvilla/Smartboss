// ข้อมูลตัวอย่างสำหรับภาพ mockup แจ้งเตือน PM (เครื่องทดสอบเท่านั้น)
import { prisma } from "@smartboss/database";
import { generateWorkOrdersForDuePms, notifyDuePmSchedules } from "@/modules/maintenance/data/cron";
(async () => {
  const { orgId } = await prisma.user.findUniqueOrThrow({ where: { id: "t-admin" }, select: { orgId: true } });
  // ล้างแจ้งเตือนเก่าของช่างในเครื่อง ให้ภาพเห็นชัด
  await prisma.notification.updateMany({ where: { orgId, userId: "t-ton", readAt: null }, data: { readAt: new Date() } });
  const pms = await prisma.pmSchedule.findMany({ where: { orgId, title: { startsWith: "PMRND" } } });
  const names: Record<string, string> = { A: "ล้างแอร์ห้องนอน", B: "เช็คปั๊มน้ำ", C: "ล้างถังเก็บน้ำ", D: "เช็คตู้คอนโทรลสระ", E: "วัดค่าน้ำสระ" };
  for (const pm of pms) {
    const t = names[pm.title.split(" ")[1]!]!;
    await prisma.pmSchedule.update({ where: { id: pm.id }, data: { title: t } });
    await prisma.workOrder.updateMany({ where: { orgId, pmScheduleId: pm.id }, data: { title: t } });
  }
  console.log(await generateWorkOrdersForDuePms());
  console.log(await notifyDuePmSchedules());
  process.exit(0);
})();
