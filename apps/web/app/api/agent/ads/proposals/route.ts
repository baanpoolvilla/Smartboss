import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { createProposal, listProposalsForAgent } from "@/modules/ads/data/proposals";

export const dynamic = "force-dynamic";

/** GET /api/agent/ads/proposals?status=approved,applied&since=ISO&customer_id=&limit= — ตามเก็บงานค้าง / ประวัติให้ AI เรียนรู้ */
export const GET = agentRoute(async (req, ctx) => listProposalsForAgent(ctx.orgId, new URL(req.url).searchParams));

/** POST /api/agent/ads/proposals — สร้างคำขอปรับ → ตรวจนโยบาย → ส่งการ์ดเข้าแชทของผู้อนุมัติ */
export const POST = agentRoute(async (req, ctx) => ({ ok: true, ...(await createProposal(ctx.orgId, await readAgentJson(req))) }));
