import { agentRoute } from "@/modules/ads/data/agent-auth";
import { botTyping } from "@/modules/ads/data/bot";

export const dynamic = "force-dynamic";

/** POST /api/agent/ads/typing — ขึ้น "Ads Agent กำลังพิมพ์…" ในกลุ่ม (หายเองในไม่กี่วินาที ส่งซ้ำระหว่าง AI คิดได้) */
export const POST = agentRoute(async (_req, ctx) => {
  await botTyping(ctx.orgId);
  return { ok: true };
});
