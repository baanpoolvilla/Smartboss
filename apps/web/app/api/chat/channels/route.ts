import type { NextRequest } from "next/server";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { createGroup, getOrCreateDm, listChannelsForUser } from "@/modules/chat/data/channels";
import { CHAT_PERMS } from "@/modules/chat/permissions";

export const dynamic = "force-dynamic";

function forbidden() {
  return Response.json({ error: "ไม่มีสิทธิ์ใช้งานโมดูลแชท" }, { status: 403 });
}

/** โพลทุก ๆ ~20 วิ (ดู useChatPolling) — คืนรายห้อง + unread count ต่อห้อง */
export async function GET() {
  try {
    const session = await requireOrg();
    if (!hasPermission(session, CHAT_PERMS.access)) return forbidden();
    const channels = await listChannelsForUser(session.orgId, session.userId);
    return Response.json({ channels });
  } catch (err) {
    console.error("[chat/channels]", err);
    return Response.json({ error: "โหลดรายชื่อห้องไม่สำเร็จ" }, { status: 500 });
  }
}

/** เริ่ม DM ใหม่ ({ type: "dm", memberId }) หรือสร้างกลุ่ม ({ type: "group", name, memberIds }) */
export async function POST(request: NextRequest) {
  try {
    const session = await requireOrg();
    if (!hasPermission(session, CHAT_PERMS.access)) return forbidden();
    const body = await request.json().catch(() => null);

    if (body?.type === "dm" && typeof body.memberId === "string") {
      const channelId = await getOrCreateDm(session.orgId, session.userId, body.memberId);
      return Response.json({ channelId });
    }

    if (body?.type === "group" && typeof body.name === "string" && Array.isArray(body.memberIds)) {
      const memberIds = body.memberIds.filter((id: unknown): id is string => typeof id === "string");
      if (memberIds.length === 0) {
        return Response.json({ error: "เลือกสมาชิกกลุ่มอย่างน้อย 1 คน" }, { status: 400 });
      }
      const channelId = await createGroup(session.orgId, session.userId, body.name, memberIds);
      return Response.json({ channelId });
    }

    return Response.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  } catch (err) {
    console.error("[chat/channels]", err);
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    return Response.json({ error: message }, { status: 500 });
  }
}
