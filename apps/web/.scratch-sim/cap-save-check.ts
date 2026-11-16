process.env.TENANT_GUARD = "strict";
import { prisma } from "@smartboss/database";
import { readBriefSettings, saveBriefSettings, PLAN_MAX_CAP_THB } from "@/modules/report_task/lib/boss-brief/server";
import { getOrgPlan } from "@/modules/report_task/lib/plan";
(async () => {
  const org = (await prisma.organization.findMany({ orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  const row = await prisma.reportTaskStore.findUnique({ where: { orgId_key: { orgId: org.id, key: "boss-brief-settings" } } });
  const plan = await getOrgPlan(org.id);
  console.log("plan", plan, "planMax", PLAN_MAX_CAP_THB[plan], "before", (await readBriefSettings(org.id)).monthlyCapThb);
  for (const v of [1, 300, 800]) {
    const s = await saveBriefSettings(org.id, { monthlyCapThb: v });
    console.log(`ตั้ง ${v} → บันทึก ${s.monthlyCapThb} · อ่านกลับ ${(await readBriefSettings(org.id)).monthlyCapThb} · รุ่น ${s.detailModel}/${s.askModel}`);
  }
  if (row) await prisma.reportTaskStore.update({ where: { orgId_key: { orgId: org.id, key: "boss-brief-settings" } }, data: { data: row.data as never, version: { increment: 1 } } });
  else await prisma.reportTaskStore.deleteMany({ where: { orgId: org.id, key: "boss-brief-settings" } });
  console.log("restored");
  await prisma.$disconnect(); process.exit(0);
})();
