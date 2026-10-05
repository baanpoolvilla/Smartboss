import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";
import { deletePack, renamePack } from "@/modules/chat/data/stickers";

export const dynamic = "force-dynamic";

/** เปลี่ยนชื่อหมวด (แอดมินแชท) — { name } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    await renamePack(actor, id, body?.name);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "sticker-packs");
  }
}

/** ลบหมวด — สติกเกอร์ในหมวดย้ายไป "ทั่วไป" (แอดมินแชท) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    await deletePack(actor, id);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "sticker-packs");
  }
}
