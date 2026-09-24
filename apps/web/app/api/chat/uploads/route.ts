import { randomUUID } from "node:crypto";

import { prisma } from "@smartboss/database";
import { rateLimit } from "@smartboss/auth/ratelimit";

import { putFile } from "@/lib/storage";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";
import { checkOrgQuota, toGB } from "@/modules/company-files/lib/quota";
import { chatActor, chatErrorResponse } from "@/modules/chat/data/route-helpers";
import type { ChatAttachmentKind } from "@/modules/chat/types";

/**
 * อัปโหลดไฟล์แนบของแชท — รูปถูกย่อในเครื่องก่อนส่งแล้ว (lib/image-compress.ts)
 * จึงปกติเหลือไม่กี่ร้อย KB ส่วนรูปย่อ (thumbnail) ก็อัปผ่านทางนี้เป็นอีกไฟล์
 *
 * ด่านตรวจ: สนิฟฟ์เนื้อไฟล์จริงแทนเชื่อ file.type, ตั้งชื่อไฟล์ใหม่จากนามสกุลที่ตรวจได้,
 * เช็คเพดานพื้นที่ของบริษัท (คลังไฟล์ + แชทรวมกัน), จำกัดจำนวนครั้งต่อคน
 * ทุกไฟล์ลงแถว chat.files — ใช้นับพื้นที่ และตรวจตอนส่งข้อความว่าไฟล์เป็นของบริษัทนี้จริง
 *
 * ขนาดสูงสุด 25MB ตามเพดาน request ของ Caddy (deploy/Caddyfile)
 */
export const dynamic = "force-dynamic";

const MB = 1024 * 1024;

const ALLOWED: Record<string, { ext: string; kind: ChatAttachmentKind; max: number }> = {
  "image/jpeg": { ext: "jpg", kind: "image", max: 10 * MB },
  "image/png": { ext: "png", kind: "image", max: 10 * MB },
  "image/webp": { ext: "webp", kind: "image", max: 10 * MB },
  "image/gif": { ext: "gif", kind: "image", max: 10 * MB },
  "application/pdf": { ext: "pdf", kind: "file", max: 25 * MB },
  "text/plain": { ext: "txt", kind: "file", max: 5 * MB },
  "text/csv": { ext: "csv", kind: "file", max: 10 * MB },
  "application/zip": { ext: "zip", kind: "file", max: 25 * MB },
  "application/msword": { ext: "doc", kind: "file", max: 25 * MB },
  "application/vnd.ms-excel": { ext: "xls", kind: "file", max: 25 * MB },
  "application/vnd.ms-powerpoint": { ext: "ppt", kind: "file", max: 25 * MB },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "file", max: 25 * MB },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", kind: "file", max: 25 * MB },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", kind: "file", max: 25 * MB },
  "video/mp4": { ext: "mp4", kind: "video", max: 25 * MB },
  "video/webm": { ext: "webm", kind: "video", max: 25 * MB },
};

/** ข้อความเสียงจาก MediaRecorder: Chrome = webm, Safari = mp4 — เนื้อไฟล์สนิฟฟ์ได้เป็น
 * video/* (คอนเทนเนอร์เดียวกัน) จึงแยกด้วยชนิดที่เครื่องบอกมาว่าเป็น audio/* */
const AUDIO_CONTAINER: Record<string, { ext: string; mime: string }> = {
  "video/webm": { ext: "webm", mime: "audio/webm" },
  "video/mp4": { ext: "mp4", mime: "audio/mp4" },
};
const MAX_AUDIO = 10 * MB;

export async function POST(request: Request) {
  try {
    const actor = await chatActor();
    const limited = await rateLimit(`chat:upload:${actor.userId}`, 60, 60);
    if (!limited.allowed) return Response.json({ error: "อัปโหลดถี่เกินไป รอสักครู่แล้วลองใหม่" }, { status: 429 });

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
    if (file.size > 25 * MB) return Response.json({ error: "ไฟล์ใหญ่เกินไป (จำกัด 25MB)" }, { status: 413 });

    const quota = await checkOrgQuota(actor.orgId, file.size);
    if (!quota.ok) {
      return Response.json(
        { error: `พื้นที่เก็บไฟล์ของบริษัทเต็มแล้ว (ใช้ไป ${toGB(quota.used)} จาก ${toGB(quota.limit)} GB) ติดต่อผู้ดูแลเพื่อเพิ่มพื้นที่` },
        { status: 413 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const claimedAudio = file.type.startsWith("audio/");
    const sniffed = sniffMime(bytes, file.type);
    if (!sniffed) return Response.json({ error: `ไม่รองรับชนิดไฟล์นี้ (${file.type || "ไม่ทราบชนิด"})` }, { status: 400 });

    let meta: { ext: string; kind: ChatAttachmentKind; max: number; mime: string };
    if (claimedAudio && AUDIO_CONTAINER[sniffed]) {
      meta = { ...AUDIO_CONTAINER[sniffed]!, kind: "audio", max: MAX_AUDIO };
    } else {
      const allowed = ALLOWED[sniffed];
      if (!allowed) return Response.json({ error: `ไม่รองรับชนิดไฟล์นี้ (${file.type || sniffed})` }, { status: 400 });
      meta = { ...allowed, mime: sniffed };
    }
    if (bytes.byteLength > meta.max) {
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (จำกัด ${Math.round(meta.max / MB)}MB)` }, { status: 413 });
    }

    const url = await putFile(`${actor.orgId}/chat`, new File([bytes], `${randomUUID()}.${meta.ext}`, { type: meta.mime }), {
      ext: meta.ext,
    });
    await prisma.chatFile.create({
      data: { orgId: actor.orgId, uploadedById: actor.userId, url, size: bytes.byteLength, mime: meta.mime, kind: meta.kind },
    });

    return Response.json({
      url,
      mime: meta.mime,
      size: bytes.byteLength,
      name: file.name.slice(0, 200) || `ไฟล์.${meta.ext}`,
      kind: meta.kind,
    });
  } catch (err) {
    return chatErrorResponse(err, "uploads");
  }
}
