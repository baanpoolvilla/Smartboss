import { agentRoute } from "@/modules/ads/data/agent-auth";
import { getProposalForAgent } from "@/modules/ads/data/proposals";

export const dynamic = "force-dynamic";

/** GET /api/agent/ads/proposals/:id — สถานะปัจจุบัน + ค่าที่อนุมัติจริง (approved) */
export const GET = agentRoute<{ id: string }>(async (_req, ctx, { id }) => ({ proposal: await getProposalForAgent(ctx.orgId, id) }));
