import type { NextRequest } from "next/server";
import { hasPermission, requireOrg } from "@smartboss/auth";

import { createMessage, listMessages, listRecentlyDeletedIds, otherMemberIds } from "@/modules/chat/data/messages";
import { orgChannelId } from "@/modules/chat/data/channels";
import { CHAT_PERMS } from "@/modules/chat/permissions";
import { notifyUsers } from "@/modules/maintenance/data/notify";
import { prisma } from "@smartboss/database";

export const dynamic = "force-dynamic";

function forbidden() {
  return Response.json({ error: "ไม่มีสิทธิ์ใช้งานโมดูลแชท" }, { status: 403 });
}

function errorResponse(err: unknown) {
  const status = (err as Error & { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
  if (status === 500) console.error("[chat/messages]", err);
  return Response.json({ error: message }, { status });
}

/**
 * โหลดข้อความ — ไม่มี ?after = หน้าแรก, มี ?after=<messageId> = โพลหาข้อความใหม่กว่านั้น
 * ทุกครั้งยังส่ง `deletedIds` (ข้อความที่เพิ่งถูกลบใน 5 นาทีล่าสุด) กลับไปด้วย —
 * client ที่มีข้อความนั้นค้างอยู่บนจอ (โหลดไปก่อนโดนลบ) จะได้เอาออกตามไปด้วย
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const session = await requireOrg();
    if (!hasPermission(session, CHAT_PERMS.access)) return forbidden();
    const after = request.nextUrl.searchParams.get("after") ?? undefined;
    // ลำดับตั้งใจ ไม่ใช่ Promise.all — listMessages เช็คสิทธิ์สมาชิกห้องก่อน
    // (โยน 403 ถ้าไม่ใช่) ต้องผ่านด่านนั้นก่อนค่อย query ข้อมูลห้องนี้ต่อ
    const messages = await listMessages(session.orgId, id, session.userId, { after });
    const deletedIds = await listRecentlyDeletedIds(id);
    return Response.json({ messages, deletedIds });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const session = await requireOrg();
    if (!hasPermission(session, CHAT_PERMS.access)) return forbidden();
    const body = await request.json().catch(() => ({}));
    const message = await createMessage(session.orgId, id, session.userId, {
      body: typeof body.body === "string" ? body.body : undefined,
      attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
    });

    // ห้องรวมทั้งบริษัทไม่ยิงแจ้งเตือนราย user — บริษัทใหญ่มีพนักงานเป็นพัน
    // ทุกข้อความในห้องนั้นจะกลาย เขียน core.notifications เป็นพันแถวต่อ 1
    // ข้อความ ซึ่งทั้งแพงและเป็นสแปมกระดิ่งที่ไม่มีใครอยากได้จริง ๆ (ตรงข้ามกับ
    // DM/กลุ่มเล็กที่แจ้งเตือนแล้วมีประโยชน์จริง) ดู otherMemberIds ว่าทำไม
    // "จำนวนคนในห้อง org" ยังคำนวณได้แม้ไม่มีแถว membership
    const isOrgChannel = id === orgChannelId(session.orgId);
    const recipients = isOrgChannel ? [] : await otherMemberIds(session.orgId, id, session.userId);
    if (recipients.length > 0) {
      const author = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
      const preview = message.body ?? (message.attachments.length > 0 ? "ส่งไฟล์แนบ" : "");
      await notifyUsers(session.orgId, recipients, {
        title: `ข้อความใหม่จาก ${author?.name ?? "เพื่อนร่วมงาน"}`,
        body: preview.slice(0, 140) || undefined,
        type: "chat_message",
        referenceId: id,
      });
    }

    return Response.json({ message });
  } catch (err) {
    return errorResponse(err);
  }
}
