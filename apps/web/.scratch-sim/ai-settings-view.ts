process.env.TENANT_GUARD = "strict";
import { prisma } from "@smartboss/database";
import { aiSettingsView } from "@/modules/report_task/lib/boss-brief/ai-settings";
(async () => {
  const org = (await prisma.organization.findMany({ orderBy: { createdAt: "asc" }, take: 1 }))[0]!;
  try { const v = await aiSettingsView(org.id, { canEdit: true, superAdmin: true }); console.log(JSON.stringify(v).slice(0, 600)); }
  catch (e) { console.error("ERR", e); }
  await prisma.$disconnect(); process.exit(0);
})();
