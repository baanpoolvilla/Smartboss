import { deleteKeepItem, setKeepItemCollections } from "@/modules/chat/data/keep";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** ย้ายเข้า/ออกคอลเลกชัน { collectionIds: string[] } */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json({ collectionIds: await setKeepItemCollections(actor, id, body?.collectionIds) });
  } catch (err) {
    return chatErrorResponse(err, "keep");
  }
}

/** ลบออกจากคลัง */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    await deleteKeepItem(actor, id);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "keep");
  }
}
