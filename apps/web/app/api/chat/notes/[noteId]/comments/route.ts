import { addComment } from "@/modules/chat/data/notes";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ noteId: string }> };

/** คอมเมนต์ { body } */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { noteId } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json({ comment: await addComment(actor, noteId, body?.body) });
  } catch (err) {
    return chatErrorResponse(err, "note-comment");
  }
}
