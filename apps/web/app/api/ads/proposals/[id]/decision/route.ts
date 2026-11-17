import { adsRoute, readJson } from "@/modules/ads/data/access";
import { decideProposal } from "@/modules/ads/data/proposals";

export const dynamic = "force-dynamic";

/**
 * POST /api/ads/proposals/:id/decision — { action: "approve"|"reject", keywords?, value?, note? }
 * กดจากการ์ดในกลุ่มแชท 🤖 Ads Agent หรือหน้าคำขอปรับ · ไม่ต้องมี permission เฉพาะ —
 * decideProposal เช็คว่าเป็นสมาชิกกลุ่ม Ads Agent (ผู้ใช้ 17/11/2569: "คนที่ถูก add เข้าไปกด approve ได้หมด")
 */
export const POST = adsRoute<{ id: string }>(null, async (req, session, { id }) => {
  const body = await readJson(req);
  const action = body.action === "reject" ? "reject" : body.action === "approve" ? "approve" : null;
  if (!action) throw new Error("action ต้องเป็น approve หรือ reject");
  await decideProposal(session.orgId, id, session.userId, {
    action,
    keywords: Array.isArray(body.keywords) ? body.keywords.filter((k): k is string => typeof k === "string") : undefined,
    value: body.value != null ? Number(body.value) : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
  });
  return { ok: true };
});
