import { removeAlbumItem } from "@/modules/chat/data/albums";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ albumId: string; itemId: string }> };

/** เอารูปออกจากอัลบั้ม (คนที่เพิ่ม หรือแอดมินห้อง) */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { albumId, itemId } = await params;
    await removeAlbumItem(actor, albumId, itemId);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "album-items");
  }
}
