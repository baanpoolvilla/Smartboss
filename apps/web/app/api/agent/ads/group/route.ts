import { prisma } from "@smartboss/database";
import { agentRoute } from "@/modules/ads/data/agent-auth";
import { approverIds, botChannelId } from "@/modules/ads/data/bot";

export const dynamic = "force-dynamic";

/** GET /api/agent/ads/group — กลุ่ม 🤖 Ads Agent: id ห้อง + สมาชิก (= คนที่อนุมัติได้) ไว้ให้ AI แท็ก/รู้ว่าใครตัดสิน */
export const GET = agentRoute(async (_req, ctx) => {
  const ids = await approverIds(ctx.orgId);
  const users = ids.length ? await prisma.user.findMany({ where: { orgId: ctx.orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  return { channel_id: botChannelId(ctx.orgId), members: users.map((u) => ({ user_id: u.id, name: u.name })) };
});
