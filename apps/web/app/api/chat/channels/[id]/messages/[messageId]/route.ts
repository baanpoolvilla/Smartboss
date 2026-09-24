import { deleteMessage } from "@/modules/chat/data/messages";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** ยกเลิกข้อความ (ของตัวเอง หรือแอดมินห้อง) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const actor = await chatActor();
    const { id, messageId } = await params;
    await deleteMessage(actor, id, messageId);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "message");
  }
}
