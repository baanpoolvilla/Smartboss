import { deleteProjectChannel, getChannelDetail, renameChannel, setAnnouncement, setChannelClosed, setChannelPrefs } from "@/modules/chat/data/channels";
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

/** แก้ห้อง: { name } เปลี่ยนชื่อ, { closed } ปิด/เปิดห้องของโปรเจกต์, { announcementId } ปัก/เอาประกาศออก, { pinned, muted } ตั้งค่าส่วนตัว */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.name === "string") await renameChannel(actor, id, body.name);
    // { closed } ปิด/เปิดห้องของโปรเจกต์ (อ่านย้อนหลังได้ ส่งใหม่ไม่ได้)
    if (typeof body.closed === "boolean") await setChannelClosed(actor, id, body.closed);
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

/** ลบห้องของโปรเจกต์ — ห้องหายจากทุกคน (เก็บเข้าคลัง ไม่ลบข้อความ) */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    await deleteProjectChannel(actor, id);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "channel");
  }
}
