import { publishToUsers } from "@/lib/realtime/server";
import { channelMemberIds, getChannelAccess } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/**
 * "กำลังพิมพ์…" — เครื่องส่งมาไม่เกินทุก 3 วิระหว่างพิมพ์ ไม่บันทึกลงฐานข้อมูล
 * ห้องรวมทั้งบริษัทไม่ส่ง (คนเป็นพัน ไม่มีประโยชน์และเปลือง)
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const access = await getChannelAccess(actor, id);
    if (access.type !== "org") {
      const others = (await channelMemberIds(actor.orgId, id)).filter((u) => u !== actor.userId);
      publishToUsers(others, { type: "chat.typing", channelId: id, userId: actor.userId });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "typing");
  }
}
