import { toggleLike } from "@/modules/chat/data/notes";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ noteId: string }> };

/** กด/เลิกกดถูกใจ */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { noteId } = await params;
    return Response.json(await toggleLike(actor, noteId));
  } catch (err) {
    return chatErrorResponse(err, "note-like");
  }
}
