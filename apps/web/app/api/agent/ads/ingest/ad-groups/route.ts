import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { ingestAdGroups } from "@/modules/ads/data/ingest";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/ingest/ad-groups — { customer_id, rows: [...] } */
export const POST = agentRoute(async (req, ctx) => ({ ok: true, ...(await ingestAdGroups(ctx.orgId, await readAgentJson(req))) }));
