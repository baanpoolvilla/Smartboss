import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { createSummary } from "@/modules/ads/data/summaries";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/summaries — { customer_id?, period_from?, period_to?, title, body, highlights?, notify?: "approvers"|"all"|[userId], chat_text? } */
export const POST = agentRoute(async (req, ctx) => ({ ok: true, ...(await createSummary(ctx.orgId, await readAgentJson(req))) }));
