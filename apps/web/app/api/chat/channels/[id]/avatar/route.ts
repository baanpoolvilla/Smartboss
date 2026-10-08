import { deleteFile, putFile } from "@/lib/storage";
import { fileTooLargeMessage } from "@/lib/file-limits";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";
import { setChannelAvatar } from "@/modules/chat/data/channels";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** ชนิดรูปที่รับ — เช็คจากไบต์จริงของไฟล์ ไม่เชื่อนามสกุล/ชนิดที่เบราว์เซอร์บอก (เหมือนรูปโปรไฟล์) */
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
/** ฝั่งเครื่องย่อรูปก่อนส่งอยู่แล้ว (room-info.tsx) — เพดานนี้กันไฟล์แปลก ๆ */
const MAX_BYTES = 5 * 1024 * 1024;

/** ตั้งรูปห้อง: multipart { avatar } — สิทธิ์ตัดสินใน setChannelAvatar (คนสร้างกลุ่ม / แอดมินแชท) */
export async function POST(request: Request, { params }: Ctx) {
  let uploaded: string | null = null;
  try {
    const actor = await chatActor();
    const { id } = await params;
    const form = await request.formData().catch(() => null);
    const file = form?.get("avatar");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "เลือกรูปก่อน" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: fileTooLargeMessage(file, MAX_BYTES) }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes, file.type);
    const ext = mime ? ALLOWED[mime] : undefined;
    if (!ext) return Response.json({ error: "รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF)" }, { status: 400 });

    uploaded = await putFile(`${actor.orgId}/chat-avatars`, new File([bytes], `${id}.${ext}`, { type: mime! }), { ext });
    const old = await setChannelAvatar(actor, id, uploaded);
    uploaded = null; // ใช้งานแล้ว ไม่ต้องลบทิ้ง
    // ลบไฟล์เก่าหลังบันทึกสำเร็จเท่านั้น (ลบก่อนแล้วพัง = รูปหาย)
    if (old) await deleteFile(old).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (err) {
    // ไม่มีสิทธิ์/ห้องเปลี่ยนรูปไม่ได้ — ไฟล์ที่เพิ่งอัปโหลดไม่ได้ใช้ ลบทิ้ง
    if (uploaded) await deleteFile(uploaded).catch(() => undefined);
    return chatErrorResponse(err, "channel");
  }
}

/** ลบรูปห้อง กลับเป็นไอคอนเดิม */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const actor = await chatActor();
    const { id } = await params;
    const old = await setChannelAvatar(actor, id, null);
    if (old) await deleteFile(old).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (err) {
    return chatErrorResponse(err, "channel");
  }
}
