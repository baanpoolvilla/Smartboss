import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { ingestSearchTerms } from "@/modules/ads/data/ingest";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/ingest/search-terms — { customer_id, rows: [...] } */
export const POST = agentRoute(async (req, ctx) => ({ ok: true, ...(await ingestSearchTerms(ctx.orgId, await readAgentJson(req))) }));
