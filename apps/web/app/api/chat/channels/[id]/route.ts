import { getChannelDetail, renameChannel, setAnnouncement, setChannelPrefs } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** รายละเอียดห้อง: สมาชิก, อ่านถึงไหนต่อคน, ประกาศ, สิทธิ์จัดการ */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    return Response.json({ channel: await getChannelDetail(actor, id) });
  } catch (err) {
    return chatErrorResponse(err, "channel");
  }
}

/** แก้ห้อง: { name } เปลี่ยนชื่อ, { announcementId } ปัก/เอาประกาศออก, { pinned, muted } ตั้งค่าส่วนตัว */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.name === "string") await renameChannel(actor, id, body.name);
    if ("announcementId" in body) {
      await setAnnouncement(actor, id, typeof body.announcementId === "string" ? body.announcementId : null);
    }
    const prefs: { pinned?: boolean; muted?: boolean } = {};
    if (typeof body.pinned === "boolean") prefs.pinned = body.pinned;
    if (typeof body.muted === "boolean") prefs.muted = body.muted;
    if (Object.keys(prefs).length > 0) await setChannelPrefs(actor, id, prefs);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "channel");
  }
}
