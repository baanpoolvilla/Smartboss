import { agentRoute } from "@/modules/ads/data/agent-auth";
import { agentReport } from "@/modules/ads/data/agent-read";

export const dynamic = "force-dynamic";

/** GET /api/agent/ads/report?customer_id=&from=&to=&compare=previous|none|YYYY-MM-DD,YYYY-MM-DD — ตัวเลข + สถานะ + ข้อสังเกตจาก Rule Engine */
export const GET = agentRoute(async (req, ctx) => agentReport(ctx.orgId, new URL(req.url).searchParams));
