import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { ingestKeywords } from "@/modules/ads/data/ingest";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/ingest/keywords — { customer_id, rows: [...] } */
export const POST = agentRoute(async (req, ctx) => ({ ok: true, ...(await ingestKeywords(ctx.orgId, await readAgentJson(req))) }));
