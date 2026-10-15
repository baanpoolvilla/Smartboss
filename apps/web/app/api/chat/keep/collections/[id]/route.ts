import { deleteCollection, renameCollection } from "@/modules/chat/data/keep";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** เปลี่ยนชื่อ { name } */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    await renameCollection(actor, id, body?.name);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "keep-collections");
  }
}

/** ลบคอลเลกชัน (ของข้างในไม่หาย) */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    await deleteCollection(actor, id);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "keep-collections");
  }
}
