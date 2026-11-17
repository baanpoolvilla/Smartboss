import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { ingestCampaigns } from "@/modules/ads/data/ingest";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/ingest/campaigns — { customer_id, rows: [...] } ดูรูปแถวใน modules/ads/data/ingest.ts */
export const POST = agentRoute(async (req, ctx) => ({ ok: true, ...(await ingestCampaigns(ctx.orgId, await readAgentJson(req))) }));
