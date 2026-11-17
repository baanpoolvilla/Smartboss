import { agentRoute } from "@/modules/ads/data/agent-auth";
import { agentSettingsView } from "@/modules/ads/data/agent-read";

export const dynamic = "force-dynamic";

/** GET /api/agent/ads/settings?customer_id= — เกณฑ์ KPI · กฎ · เป้าหมายธุรกิจ · นโยบายคำขอปรับ */
export const GET = agentRoute(async (req, ctx) => agentSettingsView(ctx.orgId, new URL(req.url).searchParams));
