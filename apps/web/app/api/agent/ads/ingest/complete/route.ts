import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { ingestComplete } from "@/modules/ads/data/ingest";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/ingest/complete — จบรอบดึงข้อมูล { customer_id, from, to, status, rows_upserted, duration_ms, error? } */
export const POST = agentRoute(async (req, ctx) => ingestComplete(ctx.orgId, await readAgentJson(req)));
