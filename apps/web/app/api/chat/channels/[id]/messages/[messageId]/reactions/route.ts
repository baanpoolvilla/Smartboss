import { toggleReaction } from "@/modules/chat/data/messages";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** กด/เอาอีโมจิออก { emoji } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const actor = await chatActor();
    const { id, messageId } = await params;
    const body = await request.json().catch(() => ({}));
    const reactions = await toggleReaction(actor, id, messageId, typeof body.emoji === "string" ? body.emoji : "");
    return Response.json({ reactions });
  } catch (err) {
    return chatErrorResponse(err, "reaction");
  }
}
