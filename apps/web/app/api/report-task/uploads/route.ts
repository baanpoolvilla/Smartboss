import { randomUUID } from "node:crypto";

import { requireOrg } from "@smartboss/auth";

import { putFile } from "@/modules/maintenance/lib/storage";
import { generateDocThumbnail } from "@/modules/report_task/lib/thumbnail/generate-doc-thumbnail";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import {
  DEFAULT_ATTACHMENT_SETTINGS,
  type AttachmentSettings,
} from "@/modules/report_task/store/attachment-settings-store";

/**
 * อัปโหลดไฟล์แนบของโมดูลรายงานและงาน
 *
 * ต้นทางเขียนลง `public/uploads/` ตรง ๆ ซึ่งใช้ไม่ได้ในระบบนี้:
 *   - ไฟล์ปนกันทุกบริษัท และเข้าถึงได้โดยไม่ต้อง login (อยู่ใต้ public/)
 *   - serverless เขียนดิสก์ไม่ได้
 *
 * เปลี่ยนมาใช้ชั้นเก็บไฟล์กลางของ Smartboss ซึ่งสลับ S3/ดิสก์ตาม env ให้เอง
 * และคืน URL รูปแบบ `/api/files/<key>` ที่ **ต้อง login** ถึงจะเปิดได้
 * โดย key นำหน้าด้วย orgId ⇒ ไฟล์ของแต่ละบริษัทแยกโฟลเดอร์กัน
 *
 * ── ตรวจชนิดไฟล์จากเนื้อไฟล์จริงสำหรับชนิดที่รู้จัก (พอร์ตมาจากต้นทาง 2026-08-08) ──
 * `file.type` ที่ client ส่งมาเป็นแค่สิ่งที่เบราว์เซอร์เดาจากนามสกุล หรือสิ่งที่
 * ผู้โจมตีตั้งเอง — เชื่อไม่ได้ จึงอ่าน magic byte มาเทียบกับลายเซ็นจริงอีกชั้น
 * เช่นเปลี่ยนชื่อ .html เป็น .txt แล้วอัปโหลด จะถูกจับได้ตรงนี้ (แล้วเก็บเป็น
 * ไฟล์ทั่วไปตามนามสกุลที่ผู้ใช้ตั้งจริง ไม่ใช่ถูกปฏิเสธ — ดูหมายเหตุด้านล่าง)
 *
 * ต่างจากต้นทางตรงที่ไม่ต้องมี route แยกสำหรับบังคับดาวน์โหลด เพราะทุกไฟล์ที่นี่
 * ออกทาง `/api/files/<key>` ซึ่งอยู่คนละโดเมนกับหน้าเว็บ (files.<โดเมน>)
 * ⇒ ต่อให้มีอะไรเรนเดอร์ได้หลุดเข้าไป ก็อ่านคุกกี้ของ app.<โดเมน> ไม่ได้
 *
 * ── ชนิดไฟล์ที่ไม่รู้จัก (รวม .html) ──
 * รับได้หมดตามที่ขอ ("ไฟล์อื่นๆ ได้ทุกไฟล์") แทนที่จะบล็อกด้วย allow-list — เก็บ
 * ตามนามสกุลที่ผู้ใช้ตั้งจริง ไม่ใช่ถูกปฏิเสธ ส่วนใหญ่ออกเป็น
 * `application/octet-stream` (บังคับดาวน์โหลด) ยกเว้น .html/.htm ที่ตั้งใจให้
 * เปิดดูตรง ๆ ในแท็บได้เลยตามที่ขอ (ดู contentTypeFor() ในเลเยอร์ storage) —
 * สคริปต์ในไฟล์ HTML จะรันได้บนโดเมนไฟล์ (files.<โดเมน>) แต่โดเมนนั้นต้อง login
 * และอ่านคุกกี้ของ app.<โดเมน> ไม่ได้ ผู้เข้าถึงคือทีมงานที่ล็อกอินแล้วเท่านั้น
 */
export const dynamic = "force-dynamic";

/**
 * ⚠ ไม่มี image/svg+xml ในนี้โดยตั้งใจ (SVG แนบ <script> ได้ และที่นี่ไม่มีตัวล้าง)
 * ยังอัปโหลดได้อยู่ดีผ่านทางเดินชนิดไม่รู้จักด้านล่าง แต่ .svg ไม่มี case พิเศษใน
 * contentTypeFor() เหมือน .html จึงยังตกไป octet-stream (บังคับดาวน์โหลด) เหมือนเดิม
 *
 * ขนาดสูงสุดต่อชนิด **ไม่ได้ตายตัวในนี้อีกต่อไป** — มาจากค่าที่บริษัทตั้งเอง
 * ที่หน้าตั้งค่า (attachment-settings-store.ts) อ่านสดทุกครั้งที่อัปโหลด
 * ไม่มีแถว = ใช้ DEFAULT_ATTACHMENT_SETTINGS
 */
const ALLOWED_TYPES: Record<string, { ext: string; kind: "image" | "file" | "video" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "application/pdf": { ext: "pdf", kind: "file" },
  "text/plain": { ext: "txt", kind: "file" },
  "application/zip": { ext: "zip", kind: "file" },
  "application/msword": { ext: "doc", kind: "file" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "file" },
  "application/vnd.ms-excel": { ext: "xls", kind: "file" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", kind: "file" },
  "application/vnd.ms-powerpoint": { ext: "ppt", kind: "file" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", kind: "file" },
  "text/csv": { ext: "csv", kind: "file" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
};

function maxBytesFor(kind: "image" | "file" | "video", settings: AttachmentSettings): number {
  const mb = kind === "image" ? settings.maxImageMB : kind === "video" ? settings.maxVideoMB : settings.maxFileMB;
  return mb * 1024 * 1024;
}

/** Extension for a file whose type isn't one of ALLOWED_TYPES — taken from
 * the name the uploader gave it (the one thing we have for something we
 * can't sniff a real signature for), stripped down to a safe, short token
 * so it can't smuggle a path segment or an extension `contentTypeFor()`
 * treats specially. Falls back to "bin" when there's nothing usable. */
function genericExt(name: string): string {
  const raw = name.split(".").pop()?.toLowerCase() ?? "";
  const cleaned = raw.replace(/[^a-z0-9]/g, "").slice(0, 12);
  return cleaned || "bin";
}

export async function POST(request: Request) {
  try {
    const session = await requireOrg();
    const stored = await readStore<AttachmentSettings>(session.orgId, "attachment-settings");
    const settings = stored.data ?? DEFAULT_ATTACHMENT_SETTINGS;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
    }

    // Anything not in ALLOWED_TYPES — including .html — is still accepted,
    // just capped at the generic "file" size limit up front (no per-kind
    // limit to look up for a type we don't recognize).
    const claimed = ALLOWED_TYPES[file.type];
    const claimedMaxBytes = maxBytesFor(claimed?.kind ?? "file", settings);
    if (file.size > claimedMaxBytes) {
      const mb = Math.round(claimedMaxBytes / 1024 / 1024);
      const actualMb = (file.size / 1024 / 1024).toFixed(1);
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (ไฟล์นี้ ${actualMb}MB ต้องไม่เกิน ${mb}MB)` }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffMime(bytes, file.type);
    const meta = sniffed ? ALLOWED_TYPES[sniffed] : null;
    // Recognized signature → use it (existing behavior: proper Content-Type,
    // thumbnail support). Anything else (unknown type, or the claimed type
    // didn't match what the bytes actually are — e.g. a renamed .html) is
    // still stored, not rejected — as a generic file named after the
    // uploader's own extension, always served back as a forced download
    // (see contentTypeFor()'s own doc comment on why that's safe even for
    // something like .html).
    const ext = meta ? meta.ext : genericExt(file.name);
    const kind = meta ? meta.kind : "file";
    const mime = sniffed ?? "application/octet-stream";
    const sniffedMaxBytes = maxBytesFor(kind, settings);
    if (bytes.byteLength > sniffedMaxBytes) {
      const mb = Math.round(sniffedMaxBytes / 1024 / 1024);
      const actualMb = (bytes.byteLength / 1024 / 1024).toFixed(1);
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (ไฟล์นี้ ${actualMb}MB ต้องไม่เกิน ${mb}MB)` }, { status: 413 });
    }

    /*
     * ตั้งชื่อใหม่จากชนิดที่ "ตรวจได้จริง" ไม่ใช่ชื่อที่ผู้ใช้ส่งมา
     * putFile เอานามสกุลจากชื่อไฟล์ไปกำหนด Content-Type ตอนเก็บ
     * ถ้าใช้ชื่อเดิม คนอัปโหลดจะเลือก Content-Type ที่ปลายทางเสิร์ฟได้เอง
     */
    const url = await putFile(
      `${session.orgId}/report-task`,
      new File([bytes], `${randomUUID()}.${ext}`, { type: mime }),
      // ส่งนามสกุลไปตรง ๆ — ตัวเดาของ storage รู้จักแต่รูปภาพ ถ้าไม่บอก
      // pdf/txt/zip/mp4 จะถูกเก็บเป็น .jpg แล้วเสิร์ฟกลับเป็น image/jpeg
      { ext }
    );

    // ภาพหน้าแรกของ pdf/word/excel/ppt ไว้แสดงแทนไอคอนเฉย ๆ — best effort
    // ล้วน ๆ (ดู generate-doc-thumbnail.ts) พังยังไงก็ไม่ทำให้ upload ไฟล์
    // จริงข้างบนพังตามไปด้วย แค่ไม่มี thumbUrl ในคำตอบ ฝั่ง client เจอ
    // thumbUrl ว่างก็ fallback ไปการ์ดไอคอนเดิมเอง — ข้ามไปเลยสำหรับชนิดที่ไม่รู้จัก
    // (generateDocThumbnail รู้จักแต่นามสกุลใน ALLOWED_TYPES)
    const thumbBuf = meta ? await generateDocThumbnail(bytes, ext) : null;
    const thumbUrl = thumbBuf
      ? await putFile(
          `${session.orgId}/report-task`,
          new File([new Uint8Array(thumbBuf)], `${randomUUID()}-thumb.png`, { type: "image/png" }),
          { ext: "png" }
        )
      : null;

    return Response.json({ url, mime, size: bytes.byteLength, thumbUrl });
  } catch (err) {
    // Wraps the whole handler, not just putFile — readStore (a Postgres
    // query) can throw too, and a narrower try/catch would leave that path
    // as a bare, unexplained 500 again. Log the real cause server-side
    // (journalctl) AND echo it back in the response — the client already
    // surfaces `error` as a toast (see task-attachment-upload.ts/
    // image-resize.ts), so whoever's reporting the bug sees the real reason
    // immediately instead of a dead end that needs server access to chase
    // down separately.
    console.error("[uploads] failed", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `อัปโหลดไม่สำเร็จ: ${detail}` }, { status: 500 });
  }
}
