import { hasPermission, requireOrg } from "@smartboss/auth";

import { deleteMessage } from "@/modules/chat/data/messages";
import { CHAT_PERMS } from "@/modules/chat/permissions";

export const dynamic = "force-dynamic";

/** ลบข้อความของตัวเอง (ส่งผิด) — soft delete, ลบได้เฉพาะคนที่ส่งเอง (ดู data/messages.ts) */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await context.params;
  try {
    const session = await requireOrg();
    if (!hasPermission(session, CHAT_PERMS.access)) {
      return Response.json({ error: "ไม่มีสิทธิ์ใช้งานโมดูลแชท" }, { status: 403 });
    }
    await deleteMessage(session.orgId, id, messageId, session.userId);
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    if (status === 500) console.error("[chat/messages/delete]", err);
    return Response.json({ error: message }, { status });
  }
}
