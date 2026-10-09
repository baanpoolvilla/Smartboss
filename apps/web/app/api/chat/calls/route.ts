import { callsEnabled, myCurrentCall, startCall } from "@/modules/chat/data/calls";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** เปิดใช้การโทรไหม + สายที่ยังไม่จบของฉัน (เปิดแอปจากแจ้งเตือนสายเข้า / รีเฟรชระหว่างคุย) */
export async function GET() {
  try {
    const actor = await chatActor();
    if (!callsEnabled()) return Response.json({ enabled: false, meId: actor.userId, call: null });
    return Response.json({ enabled: true, meId: actor.userId, call: await myCurrentCall(actor) });
  } catch (err) {
    return chatErrorResponse(err, "calls");
  }
}

/** เริ่มโทร: { channelId } → { call, url, token } (url/token ไว้ต่อ LiveKit) */
export async function POST(request: Request) {
  try {
    const actor = await chatActor();
    const body = (await request.json().catch(() => null)) as { channelId?: unknown } | null;
    if (typeof body?.channelId !== "string" || !body.channelId) return Response.json({ error: "ไม่ระบุห้อง" }, { status: 400 });
    return Response.json(await startCall(actor, body.channelId));
  } catch (err) {
    return chatErrorResponse(err, "calls");
  }
}
