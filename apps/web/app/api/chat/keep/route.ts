import { keepMessage, listKeep } from "@/modules/chat/data/keep";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** คลัง Keep ของตัวเอง ?tab=all|image|video|link|file|text &q= &collection= &before=<createdAt> */
export async function GET(request: Request) {
  try {
    const actor = await chatActor();
    const sp = new URL(request.url).searchParams;
    return Response.json(
      await listKeep(actor, {
        tab: sp.get("tab") ?? undefined,
        q: sp.get("q") ?? undefined,
        collectionId: sp.get("collection") ?? undefined,
        before: sp.get("before") ?? undefined,
      })
    );
  } catch (err) {
    return chatErrorResponse(err, "keep");
  }
}

/** ปุ่ม "Keep" ที่ข้อความ { channelId, messageId } */
export async function POST(request: Request) {
  try {
    const actor = await chatActor();
    const body = await request.json().catch(() => ({}));
    if (typeof body?.channelId !== "string" || typeof body?.messageId !== "string") {
      return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
    }
    return Response.json(await keepMessage(actor, body.channelId, body.messageId));
  } catch (err) {
    return chatErrorResponse(err, "keep");
  }
}
