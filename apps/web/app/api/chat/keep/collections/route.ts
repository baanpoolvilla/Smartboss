import { createCollection } from "@/modules/chat/data/keep";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** สร้างคอลเลกชัน { name } */
export async function POST(request: Request) {
  try {
    const actor = await chatActor();
    const body = await request.json().catch(() => ({}));
    return Response.json(await createCollection(actor, body?.name));
  } catch (err) {
    return chatErrorResponse(err, "keep-collections");
  }
}
