import { onlineUserIds } from "@/lib/realtime/server";
import { listOrgUsersForPicker } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** พนักงานทั้งบริษัท (ชื่อ/รูป/แผนก) + ใครออนไลน์อยู่ — เครื่องดึงซ้ำทุก 60 วิเพื่ออัปเดตจุดเขียว */
export async function GET() {
  try {
    const actor = await chatActor();
    const users = await listOrgUsersForPicker(actor.orgId);
    const online = await onlineUserIds(users.map((u) => u.id));
    return Response.json({ users, onlineIds: [...online] });
  } catch (err) {
    return chatErrorResponse(err, "users");
  }
}
