import { createGroup, getOrCreateDm, listChannelsForUser } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** รายการห้องของผู้ใช้ + ยังไม่อ่าน/ถูกแท็ก ต่อห้อง */
export async function GET() {
  try {
    const actor = await chatActor();
    return Response.json({ channels: await listChannelsForUser(actor.orgId, actor.userId) });
  } catch (err) {
    return chatErrorResponse(err, "channels");
  }
}

/** เริ่ม DM ({ type: "dm", memberId }) หรือสร้างกลุ่ม ({ type: "group", name, memberIds }) */
export async function POST(request: Request) {
  try {
    const actor = await chatActor();
    const body = await request.json().catch(() => null);
    if (body?.type === "dm" && typeof body.memberId === "string") {
      return Response.json({ channelId: await getOrCreateDm(actor.orgId, actor.userId, body.memberId) });
    }
    if (body?.type === "group" && typeof body.name === "string" && Array.isArray(body.memberIds)) {
      const memberIds = body.memberIds.filter((id: unknown): id is string => typeof id === "string");
      return Response.json({ channelId: await createGroup(actor.orgId, actor.userId, body.name, memberIds) });
    }
    return Response.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
  } catch (err) {
    return chatErrorResponse(err, "channels");
  }
}
