import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { addProposalMeasurement } from "@/modules/ads/data/proposals";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/proposals/:id/measurement — { days: 7, summary, metrics? } ผลหลังปรับ (ขึ้นในการ์ด) */
export const POST = agentRoute<{ id: string }>(async (req, ctx, { id }) => addProposalMeasurement(ctx.orgId, id, await readAgentJson(req)));
