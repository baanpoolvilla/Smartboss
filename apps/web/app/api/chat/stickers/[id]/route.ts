import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";
import { deleteSticker, updateSticker } from "@/modules/chat/data/stickers";

export const dynamic = "force-dynamic";

/** แก้ชื่อ/คำค้น/ย้ายหมวด (แอดมินแชท) — { name?, keywords?, packId? } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json({ sticker: await updateSticker(actor, id, body ?? {}) });
  } catch (err) {
    return chatErrorResponse(err, "stickers");
  }
}

/** เอาสติกเกอร์ออกจากชุด (แอดมินแชท) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    await deleteSticker(actor, id);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "stickers");
  }
}
