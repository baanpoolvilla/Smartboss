import { agentRoute } from "@/modules/ads/data/agent-auth";
import { claimProposal } from "@/modules/ads/data/proposals";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/ads/proposals/:id/claim — จองสิทธิ์ยิง (approved → executing) ต้องเรียกก่อนแตะ Google Ads ทุกครั้ง
 * 409 = ยังไม่อนุมัติ / มีรอบอื่นจองไปแล้ว / ถูกปฏิเสธ — ห้ามยิง
 */
export const POST = agentRoute<{ id: string }>(async (_req, ctx, { id }) => claimProposal(ctx.orgId, id));
