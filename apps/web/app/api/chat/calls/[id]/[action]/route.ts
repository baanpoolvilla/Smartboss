import { answerCall, declineCall, endCall, rejoinCall } from "@/modules/chat/data/calls";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; action: string }> };

/** answer / rejoin → { call, url, token } · decline / end → { ok } (ปุ่มปฏิเสธในแจ้งเตือนเรียก decline ตรงจาก sw.js) */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id, action } = await params;
    switch (action) {
      case "answer":
        return Response.json(await answerCall(actor, id));
      case "rejoin":
        return Response.json(await rejoinCall(actor, id));
      case "decline":
        await declineCall(actor, id);
        return Response.json({ ok: true });
      case "end":
        await endCall(actor, id);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "ไม่รู้จักคำสั่ง" }, { status: 404 });
    }
  } catch (err) {
    return chatErrorResponse(err, "calls");
  }
}
