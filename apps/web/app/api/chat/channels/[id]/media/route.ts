import { listChannelMedia, type MediaKind } from "@/modules/chat/data/messages";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** คลังของห้อง ?kind=media|file|link&before=<seq> */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const raw = sp.get("kind");
    const kind: MediaKind = raw === "file" || raw === "link" ? raw : "media";
    return Response.json(await listChannelMedia(actor, id, kind, sp.get("before") ?? undefined));
  } catch (err) {
    return chatErrorResponse(err, "media");
  }
}
