import { myReactionUsage } from "@/modules/chat/data/messages";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** อีโมจิที่ฉันกดบ่อย/ล่าสุด — ใช้เรียงแถบกดอีโมจิ */
export async function GET() {
  try {
    const actor = await chatActor();
    return Response.json({ usage: await myReactionUsage(actor) });
  } catch (err) {
    return chatErrorResponse(err, "reactions");
  }
}
