import "server-only";
import { createHmac } from "node:crypto";
import { webhookTarget } from "./agent-settings";

/**
 * Smartboss → n8n — ส่งเหตุการณ์ไปที่ Webhook node ของ n8n (URL ตั้งที่หน้า "การเชื่อมต่อ n8n")
 *
 *   POST <webhook_url>
 *   X-Smartboss-Event:     bot.message | proposal.approved | proposal.rejected | ping
 *   X-Smartboss-Timestamp: วินาที unix
 *   X-Smartboss-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *   body: { event, org_id, sent_at, data }
 *
 * n8n ต้องตรวจลายเซ็นก่อนทำอะไร และไม่เชื่อข้อมูลใน body สำหรับงานที่แตะเงิน
 * (proposal.approved ส่งแค่ id — n8n ต้องเรียก POST /api/agent/ads/proposals/:id/claim เอง)
 *
 * ไม่ throw และไม่ลองซ้ำ: เครื่อง n8n อาจปิดอยู่ (Windows หลับ/รีบูต) — งานที่ค้าง n8n ตามเก็บได้จาก
 * GET /api/agent/ads/proposals?status=approved ตอนกลับมาออนไลน์ ไม่ต้องพึ่ง webhook ที่หลุดไป
 */

export type AgentEvent = "bot.message" | "proposal.approved" | "proposal.rejected" | "ping";

export async function sendAgentWebhook(
  orgId: string,
  event: AgentEvent,
  data: Record<string, unknown>
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const target = await webhookTarget(orgId).catch(() => null);
  if (!target) return { ok: false, error: "ยังไม่ได้ตั้ง Webhook URL / secret" };
  const body = JSON.stringify({ event, org_id: orgId, sent_at: new Date().toISOString(), data });
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", target.secret).update(`${ts}.${body}`).digest("hex");
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smartboss-Event": event,
        "X-Smartboss-Timestamp": ts,
        "X-Smartboss-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`[ads-webhook] ${event} → HTTP ${res.status}`);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[ads-webhook] ${event} ส่งไม่สำเร็จ: ${error}`);
    return { ok: false, error };
  }
}
