import { randomUUID } from "node:crypto";

import { hasPermission, requireOrg } from "@smartboss/auth";

import { putFile } from "@/modules/maintenance/lib/storage";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";
import { CHAT_PERMS } from "@/modules/chat/permissions";

/**
 * อัปโหลดไฟล์แนบของแชท — ก็อปมาจาก apps/web/app/api/report-task/uploads/route.ts
 * เกือบทั้งดุ้น (putFile + sniffMime ตัวเดียวกัน) ต่างแค่ prefix ที่เก็บกับขนาด
 * จำกัดที่ตายตัวไว้ก่อน (ยังไม่มีหน้าตั้งค่าแยกต่อบริษัทแบบ report_task's
 * attachment-settings ใน MVP นี้)
 *
 * เหตุผลของทุกด่านตรวจดูคอมเมนต์ในไฟล์ต้นฉบับ — ที่นี่คงไว้ทั้งหมด: สนิฟฟ์เนื้อไฟล์
 * จริงแทนเชื่อ file.type, ตั้งชื่อไฟล์ใหม่จากนามสกุลที่ตรวจได้ ไม่ใช่ชื่อที่ client ส่งมา
 */
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, { ext: string; kind: "image" | "file" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "application/pdf": { ext: "pdf", kind: "file" },
  "text/plain": { ext: "txt", kind: "file" },
  "application/zip": { ext: "zip", kind: "file" },
};

function maxBytesFor(kind: "image" | "file"): number {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
}

export async function POST(request: Request) {
  try {
    const session = await requireOrg();
    if (!hasPermission(session, CHAT_PERMS.access)) {
      return Response.json({ error: "ไม่มีสิทธิ์ใช้งานโมดูลแชท" }, { status: 403 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
    }

    const claimed = ALLOWED_TYPES[file.type];
    if (!claimed) {
      return Response.json({ error: `ไม่รองรับชนิดไฟล์นี้ (${file.type || "ไม่ทราบชนิด"})` }, { status: 400 });
    }
    if (file.size > maxBytesFor(claimed.kind)) {
      const mb = Math.round(maxBytesFor(claimed.kind) / 1024 / 1024);
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (จำกัด ${mb}MB)` }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffMime(bytes, file.type);
    const meta = sniffed ? ALLOWED_TYPES[sniffed] : null;
    if (!sniffed || !meta) {
      return Response.json({ error: "เนื้อไฟล์ไม่ตรงกับชนิดที่แจ้ง" }, { status: 400 });
    }
    if (bytes.byteLength > maxBytesFor(meta.kind)) {
      const mb = Math.round(maxBytesFor(meta.kind) / 1024 / 1024);
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (จำกัด ${mb}MB)` }, { status: 413 });
    }

    const url = await putFile(
      `${session.orgId}/chat`,
      new File([bytes], `${randomUUID()}.${meta.ext}`, { type: sniffed }),
      { ext: meta.ext }
    );
    return Response.json({
      url,
      mime: sniffed,
      size: bytes.byteLength,
      name: file.name.slice(0, 200),
      kind: meta.kind,
    });
  } catch (err) {
    console.error("[chat/uploads] failed", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `อัปโหลดไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
