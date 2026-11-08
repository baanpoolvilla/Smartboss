import { postTaskCardToRoom } from "@/modules/chat/data/task-cards";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/**
 * เปิดงานจากข้อความในห้องแชทกลุ่ม → การ์ดงานขึ้นในห้องนั้น ตอบกลับข้อความต้นทาง (ผู้ใช้ 8/11/2569)
 * body: { taskId, title, replyToId? } · ห้อง 1:1 ไม่โพสต์ (การ์ดลงแชทส่วนตัวอยู่แล้ว)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { taskId?: unknown; title?: unknown; replyToId?: unknown };
    if (typeof body.taskId !== "string" || !body.taskId) return Response.json({ error: "taskId" }, { status: 400 });
    return Response.json(
      await postTaskCardToRoom(actor.orgId, {
        channelId: id,
        authorId: actor.userId,
        taskId: body.taskId,
        title: typeof body.title === "string" ? body.title : "งาน",
        replyToId: typeof body.replyToId === "string" ? body.replyToId : null,
      }),
    );
  } catch (err) {
    return chatErrorResponse(err, "task-card");
  }
}
