import { addAlbumItems } from "@/modules/chat/data/albums";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ albumId: string }> };

/** เพิ่มรูป { items: [{ url, thumbUrl?, name?, width?, height?, sourceMessageId? }] } */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { albumId } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json(await addAlbumItems(actor, albumId, body?.items));
  } catch (err) {
    return chatErrorResponse(err, "album-items");
  }
}
