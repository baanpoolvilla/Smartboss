import { listChannelsForUser } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** ตัวเลขบนเมนู "แชท" — รวมยังไม่อ่านทุกห้องที่ไม่ได้ปิดเสียง (ปิดเสียงนับเฉพาะที่ถูกแท็ก) */
export async function GET() {
  try {
    const actor = await chatActor();
    const channels = await listChannelsForUser(actor.orgId, actor.userId);
    let unread = 0;
    for (const c of channels) unread += c.muted ? c.mentionCount : c.unreadCount;
    // ห้องที่ปิดเสียงไว้ — ตัวเด้งแจ้งเตือนในเว็บจะได้ไม่เด้งห้องพวกนี้
    const mutedIds = channels.filter((c) => c.muted).map((c) => c.id);
    return Response.json({ unread, userId: actor.userId, mutedIds });
  } catch (err) {
    return chatErrorResponse(err, "unread");
  }
}
