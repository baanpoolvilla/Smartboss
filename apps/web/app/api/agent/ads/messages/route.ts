import { agentRoute, readAgentJson } from "@/modules/ads/data/agent-auth";
import { postBotText } from "@/modules/ads/data/bot";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/ads/messages — บอทส่งข้อความเข้ากลุ่ม "🤖 Ads Agent"
 * { text, reply_to_message_id?, mention_user_ids? }
 * ตอบ bot.message: reply_to_message_id = message_id ที่ได้มา + mention_user_ids = [user_id] ให้เด้งหาคนถาม
 */
export const POST = agentRoute(async (req, ctx) => {
  const body = await readAgentJson(req);
  const text = typeof body.text === "string" ? body.text : "";
  const mentions = Array.isArray(body.mention_user_ids) ? body.mention_user_ids.filter((x): x is string => typeof x === "string") : [];
  const replyTo = typeof body.reply_to_message_id === "string" ? body.reply_to_message_id : null;
  return { ok: true, ...(await postBotText(ctx.orgId, text, { replyToId: replyTo, mentionUserIds: mentions })) };
});
