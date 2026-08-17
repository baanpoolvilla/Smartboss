import { hasPermission, requireOrg } from "@smartboss/auth";

import { assertChannelMember, markChannelRead } from "@/modules/chat/data/channels";
import { CHAT_PERMS } from "@/modules/chat/permissions";

export const dynamic = "force-dynamic";

/** ล้าง unread badge ของห้องนี้ — เรียกตอนเปิดห้อง/ห้องขึ้นมาเป็นห้องที่กำลังดูอยู่ */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const session = await requireOrg();
    if (!hasPermission(session, CHAT_PERMS.access)) {
      return Response.json({ error: "ไม่มีสิทธิ์ใช้งานโมดูลแชท" }, { status: 403 });
    }
    await assertChannelMember(session.orgId, id, session.userId);
    await markChannelRead(id, session.userId, session.orgId);
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    if (status === 500) console.error("[chat/read]", err);
    return Response.json({ error: message }, { status });
  }
}
