import { postTaskCard } from "@/modules/chat/data/task-cards";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** การ์ดงานลงห้อง { taskId, sourceMessageId? } — หลังสร้างงานจากแชท */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body?.taskId !== "string") return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
    const source = typeof body?.sourceMessageId === "string" ? body.sourceMessageId : null;
    return Response.json(await postTaskCard(actor, id, body.taskId, source));
  } catch (err) {
    return chatErrorResponse(err, "task-card");
  }
}
