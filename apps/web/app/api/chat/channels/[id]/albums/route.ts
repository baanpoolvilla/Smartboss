import { createAlbum, listAlbums } from "@/modules/chat/data/albums";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** อัลบั้มของห้อง (ใหม่ → เก่า) */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    return Response.json({ albums: await listAlbums(actor, id) });
  } catch (err) {
    return chatErrorResponse(err, "albums");
  }
}

/** สร้างอัลบั้ม { name } */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json(await createAlbum(actor, id, body?.name));
  } catch (err) {
    return chatErrorResponse(err, "albums");
  }
}
