import { prisma } from "@smartboss/database";
import { notifyDuePmSchedules } from "@/modules/maintenance/data/cron";
(async () => {
  const { orgId } = await prisma.user.findUniqueOrThrow({ where: { id: "t-admin" }, select: { orgId: true } });
  const prop = await prisma.property.findFirstOrThrow({ where: { orgId, archivedAt: null } });
  const day = (n: number) => { const d = new Date(Date.now() + 7 * 3600e3 + n * 86_400_000).toISOString().slice(0, 10); return new Date(`${d}T23:59:59.999+07:00`); };
  const cases = [7, 3, 2, 1, 0, -1];
  const ws = [];
  for (const n of cases) ws.push(await prisma.workOrder.create({ data: { orgId, propertyId: prop.id, code: `PRD-${n}`, title: `ทดสอบเตือน ${n}`, assignedTo: "t-ton", createdBy: "t-admin", ccUserIds: ["t-hr"], dueDate: day(n) } }));
  await notifyDuePmSchedules();
  const ns = await prisma.notification.findMany({ where: { orgId, referenceId: { in: ws.map((w) => w.id) } }, select: { userId: true, title: true, referenceId: true } });
  let ok = true;
  for (const [i, n] of cases.entries()) {
    const got = ns.filter((x) => x.referenceId === ws[i]!.id);
    const want = n !== 2;
    const good = want ? got.length === 1 && got[0]!.userId === "t-ton" : got.length === 0;
    if (!good) ok = false;
    console.log(`${good ? "PASS" : "FAIL"} | ครบกำหนดอีก ${n} วัน → ${want ? "เตือน" : "ไม่เตือน"} | ${got.map((x) => x.title).join(" / ")}`);
  }
  console.log(ns.every((x) => x.userId === "t-ton") ? "PASS | แจ้งแค่ผู้รับผิดชอบ (CC ไม่ได้)" : "FAIL | มีคนอื่นได้");
  await prisma.notification.deleteMany({ where: { orgId, referenceId: { in: ws.map((w) => w.id) } } });
  await prisma.workOrder.deleteMany({ where: { orgId, id: { in: ws.map((w) => w.id) } } });
  process.exit(ok ? 0 : 1);
})();
