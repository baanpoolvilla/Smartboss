import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";
import { createPack } from "@/modules/chat/data/stickers";

export const dynamic = "force-dynamic";

/** สร้างหมวดสติกเกอร์ (แอดมินแชท) — { name } */
export async function POST(request: Request) {
  try {
    const actor = await chatActor();
    const body = await request.json().catch(() => ({}));
    return Response.json({ pack: await createPack(actor, body?.name) });
  } catch (err) {
    return chatErrorResponse(err, "sticker-packs");
  }
}
