import { randomUUID } from "node:crypto";

import { requireOrg, hasPermission } from "@smartboss/auth";

import { putFile } from "@/lib/storage";
import { sniffCompanyFileMime } from "@/modules/company-files/lib/upload-sniff";
import { COMPANY_FILES_PERMS } from "@/modules/company-files/permissions";
import { MAX_FILE_MB } from "@/modules/company-files/constants";

/**
 * อัปโหลดไฟล์ของโมดูล "ไฟล์บริษัท" — เก็บผ่านชั้นเก็บไฟล์กลางเดียวกับ
 * report-task/chat/maintenance (apps/web/lib/storage) คนละ prefix
 * (`<orgId>/company-files`) ไม่ปนกับไฟล์โมดูลอื่น
 *
 * แค่เก็บไบต์ + คืน storageKey/ขนาด/ชนิดที่ตรวจจริงแล้ว — ไม่สร้างแถวในฐานข้อมูล
 * ที่นี่ (นั่นเป็นหน้าที่ของ createFile()/addFileVersion() ใน data/files.ts
 * ซึ่งเรียกหลังอัปโหลดสำเร็จ) เพื่อให้จุดเดียวเท่านั้นที่เขียนแถว CompanyFile/
 * CompanyFileVersion — กันแถวกำพร้าถ้าอัปโหลดสำเร็จแต่บันทึกฐานข้อมูลพัง
 */
export const dynamic = "force-dynamic";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/zip": "zip",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const MAX_BYTES = MAX_FILE_MB * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const session = await requireOrg();
    if (!hasPermission(session, COMPANY_FILES_PERMS.upload)) {
      return Response.json({ error: "ไม่มีสิทธิ์อัปโหลดไฟล์" }, { status: 403 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const originalName = typeof form?.get("name") === "string" ? String(form.get("name")) : null;
    if (!(file instanceof File)) {
      return Response.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
    }
    if (!MIME_TO_EXT[file.type]) {
      return Response.json({ error: `ไม่รองรับชนิดไฟล์นี้ (${file.type || "ไม่ทราบชนิด"})` }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (จำกัด ${MAX_FILE_MB}MB)` }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffCompanyFileMime(bytes, file.type);
    const ext = sniffed ? MIME_TO_EXT[sniffed] : null;
    if (!sniffed || !ext) {
      return Response.json({ error: "เนื้อไฟล์ไม่ตรงกับชนิดที่แจ้ง" }, { status: 400 });
    }
    if (bytes.byteLength > MAX_BYTES) {
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (จำกัด ${MAX_FILE_MB}MB)` }, { status: 413 });
    }

    const url = await putFile(
      `${session.orgId}/company-files`,
      new File([bytes], `${randomUUID()}.${ext}`, { type: sniffed }),
      { ext }
    );

    return Response.json({
      url,
      mimeType: sniffed,
      size: bytes.byteLength,
      name: originalName || file.name || `ไฟล์.${ext}`,
    });
  } catch (err) {
    console.error("[company-files/uploads] failed", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `อัปโหลดไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
