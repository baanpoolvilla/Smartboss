import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { reportProposalResult } from "@/modules/ads/data/proposals";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/proposals/:id/result — { status: "applied"|"failed"|"stale", result?, error? } */
export const POST = agentRoute<{ id: string }>(async (req, ctx, { id }) => reportProposalResult(ctx.orgId, id, await readAgentJson(req)));
