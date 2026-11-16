import { prisma } from "@smartboss/database";
import { notifyDuePmSchedules } from "@/modules/maintenance/data/cron";
(async () => {
  const { orgId } = await prisma.user.findUniqueOrThrow({ where: { id: "t-admin" }, select: { orgId: true } });
  const prop = await prisma.property.findFirstOrThrow({ where: { orgId, archivedAt: null } });
  const day = (n: number) => { const d = new Date(Date.now() + 7 * 3600e3 + n * 86_400_000).toISOString().slice(0, 10); return new Date(`${d}T23:59:59.999+07:00`); };
  const mk = (code: string, n: number) => prisma.workOrder.create({ data: { orgId, code, propertyId: prop.id, title: `ส่วนตัวทดสอบ ${code}`, assignedTo: "t-admin", createdBy: "t-admin", isPrivate: true, requiresExpense: false, dueDate: day(n), ccUserIds: ["t-ton"] } });
  const ws = [await mk("PRV-1", 1), await mk("PRV-2", -1), await mk("PRV-3", 2)];
  await notifyDuePmSchedules();
  const ns = await prisma.notification.findMany({ where: { orgId, referenceId: { in: ws.map((w) => w.id) } }, select: { userId: true, title: true, referenceId: true } });
  const ok1 = ns.length === 2 && ns.every((n) => n.userId === "t-admin");
  console.log(ok1 ? "PASS | เตือนเฉพาะคนเปิด 2 ใบ (พรุ่งนี้ + เลย 1 วัน) ไม่เตือนใบที่อีก 2 วัน · CC ไม่ได้" : "FAIL", JSON.stringify(ns.map((n) => [n.userId, n.title])));
  await prisma.notification.deleteMany({ where: { orgId, referenceId: { in: ws.map((w) => w.id) } } });
  await prisma.workOrder.deleteMany({ where: { orgId, id: { in: ws.map((w) => w.id) } } });
  process.exit(0);
})();
