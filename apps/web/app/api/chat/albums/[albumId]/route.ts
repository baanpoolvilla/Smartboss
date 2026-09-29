import { deleteAlbum, getAlbum, renameAlbum } from "@/modules/chat/data/albums";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ albumId: string }> };

/** อัลบั้ม + รูปทั้งหมด */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { albumId } = await params;
    return Response.json(await getAlbum(actor, albumId));
  } catch (err) {
    return chatErrorResponse(err, "album");
  }
}

/** เปลี่ยนชื่อ { name } */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { albumId } = await params;
    const body = await request.json().catch(() => ({}));
    await renameAlbum(actor, albumId, body?.name);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "album");
  }
}

/** ลบอัลบั้ม — รูปที่มาจากแชทกลับไปหมดอายุตามปกติ รูปที่อัปโหลดเข้าอัลบั้มตรงถูกลบ */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { albumId } = await params;
    await deleteAlbum(actor, albumId);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "album");
  }
}
