import { prisma } from "@smartboss/database";
(async () => {
  const { orgId } = await prisma.user.findUniqueOrThrow({ where: { id: "t-admin" }, select: { orgId: true } });
  const wo = await prisma.workOrder.findFirstOrThrow({ where: { orgId, title: { startsWith: "PMRND A" }, pmRoundDate: { not: null } } });
  const n = await prisma.notification.findMany({ where: { orgId, referenceId: wo.id }, select: { userId: true, title: true, body: true } });
  const card = await prisma.chatMessage.findFirst({ where: { orgId, clientId: `wo-${wo.id}` }, select: { authorId: true } });
  console.log(n.some((x) => x.userId === "t-ton" && x.title.includes("ได้รับมอบหมายงานใหม่: PM")) ? "PASS | ช่างได้แจ้งเตือนให้รับงาน" : "FAIL | notif", JSON.stringify(n));
  console.log((card as any)?.authorId === "t-admin" ? "PASS | การ์ดเข้าแชทส่วนตัว (คนสร้างแผน → ช่าง)" : "FAIL | card " + JSON.stringify(card));
  process.exit(0);
})();
