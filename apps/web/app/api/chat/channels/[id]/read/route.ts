import { markChannelRead } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** อ่านห้องนี้ถึงข้อความล่าสุดแล้ว (ล้างตัวเลข + ส่ง "อ่านแล้ว" ให้คนอื่นในห้อง) */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    return Response.json({ lastReadSeq: await markChannelRead(actor, id) });
  } catch (err) {
    return chatErrorResponse(err, "read");
  }
}
