import { after } from "next/server";

import { createMessage, listMessages, messagesAround, searchMessages } from "@/modules/chat/data/messages";
import { notifyNewMessage } from "@/modules/chat/data/notify";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * ข้อความของห้อง — ?before=<seq> เลื่อนดูเก่า, ?after=<seq> ดึงส่วนที่พลาด,
 * ?around=<messageId> กระโดดไปข้อความนั้น, ?q=<คำ> ค้นหา
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const q = sp.get("q");
    if (q != null) return Response.json({ messages: await searchMessages(actor, id, q), hasMore: false });
    const around = sp.get("around");
    if (around) return Response.json(await messagesAround(actor, id, around));
    return Response.json(
      await listMessages(actor, id, {
        after: sp.get("after") ?? undefined,
        before: sp.get("before") ?? undefined,
      })
    );
  } catch (err) {
    return chatErrorResponse(err, "messages");
  }
}

/** ส่งข้อความ { body?, attachments?, replyToId?, mentions?, clientId } */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await createMessage(actor, id, {
      body: typeof body.body === "string" ? body.body : undefined,
      attachments: body.attachments,
      replyToId: typeof body.replyToId === "string" ? body.replyToId : undefined,
      mentions: Array.isArray(body.mentions) ? body.mentions : undefined,
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
    });
    // แจ้งเตือนทำหลังตอบกลับแล้ว — ผู้ส่งไม่ต้องรอ Web Push/กระดิ่ง
    if (result.created) {
      after(() => notifyNewMessage(actor, id, result.channelType, result.memberIds, result.message));
    }
    return Response.json({ message: result.message });
  } catch (err) {
    return chatErrorResponse(err, "messages");
  }
}
