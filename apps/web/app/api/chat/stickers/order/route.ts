import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";
import { reorderStickers } from "@/modules/chat/data/stickers";

export const dynamic = "force-dynamic";

/** เรียงหมวด/สติกเกอร์ใหม่ (แอดมินแชท) — { packIds?: string[], stickerIds?: string[] } ตามลำดับที่ต้องการ */
export async function PUT(request: Request) {
  try {
    const actor = await chatActor();
    await reorderStickers(actor, (await request.json().catch(() => ({}))) ?? {});
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "stickers");
  }
}
