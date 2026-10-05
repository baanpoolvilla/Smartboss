import { onlineUserIds } from "@/lib/realtime/server";
import { listOrgUsersForPicker } from "@/modules/chat/data/channels";
import { offTodayByUser } from "@/modules/chat/data/off-today";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

/** พนักงานทั้งบริษัท (ชื่อ/รูป/แผนก) + ใครออนไลน์อยู่ + ใครหยุดวันนี้ — เครื่องดึงซ้ำทุก 60 วิเพื่ออัปเดตจุดเขียว */
export async function GET() {
  try {
    const actor = await chatActor();
    const users = await listOrgUsersForPicker(actor.orgId);
    const [online, off] = await Promise.all([onlineUserIds(users.map((u) => u.id)), offTodayByUser(actor.orgId)]);
    // off = คนที่หยุดวันนี้ + หยุดแบบไหน (ใบลา/วันหยุดที่อนุมัติแล้ว) — ป้ายปฏิทินบนรูปโปรไฟล์
    return Response.json({ users, onlineIds: [...online], off });
  } catch (err) {
    return chatErrorResponse(err, "users");
  }
}
