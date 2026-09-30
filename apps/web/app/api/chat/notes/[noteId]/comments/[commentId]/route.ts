import { deleteComment } from "@/modules/chat/data/notes";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ noteId: string; commentId: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { noteId, commentId } = await params;
    await deleteComment(actor, noteId, commentId);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "note-comment");
  }
}
