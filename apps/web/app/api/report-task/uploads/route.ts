import { randomUUID } from "node:crypto";

import { requireOrg } from "@smartboss/auth";

import { putFile } from "@/modules/maintenance/lib/storage";
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
 * ── ตรวจชนิดไฟล์จากเนื้อไฟล์จริง (พอร์ตมาจากต้นทาง 2026-08-08) ──
 * `file.type` ที่ client ส่งมาเป็นแค่สิ่งที่เบราว์เซอร์เดาจากนามสกุล หรือสิ่งที่
 * ผู้โจมตีตั้งเอง — เชื่อไม่ได้ จึงอ่าน magic byte มาเทียบกับลายเซ็นจริงอีกชั้น
 * เช่นเปลี่ยนชื่อ .html เป็น .txt แล้วอัปโหลด จะถูกปฏิเสธที่นี่
 *
 * ต่างจากต้นทางตรงที่ไม่ต้องมี route แยกสำหรับบังคับดาวน์โหลด เพราะทุกไฟล์ที่นี่
 * ออกทาง `/api/files/<key>` ซึ่งอยู่คนละโดเมนกับหน้าเว็บ (files.<โดเมน>)
 * ⇒ ต่อให้มีอะไรเรนเดอร์ได้หลุดเข้าไป ก็อ่านคุกกี้ของ app.<โดเมน> ไม่ได้
 */
export const dynamic = "force-dynamic";

/**
 * ⚠ ไม่มี image/svg+xml โดยตั้งใจ — SVG แนบ <script> ได้ และที่นี่ไม่มีตัวล้าง
 * อย่าเพิ่มเข้ามาถ้ายังไม่มีตัวล้าง
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
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
};

function maxBytesFor(kind: "image" | "file" | "video", settings: AttachmentSettings): number {
  const mb = kind === "image" ? settings.maxImageMB : kind === "video" ? settings.maxVideoMB : settings.maxFileMB;
  return mb * 1024 * 1024;
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

    const claimed = ALLOWED_TYPES[file.type];
    if (!claimed) {
      return Response.json({ error: `ไม่รองรับชนิดไฟล์นี้ (${file.type || "ไม่ทราบชนิด"})` }, { status: 400 });
    }
    const claimedMaxBytes = maxBytesFor(claimed.kind, settings);
    if (file.size > claimedMaxBytes) {
      const mb = Math.round(claimedMaxBytes / 1024 / 1024);
      const actualMb = (file.size / 1024 / 1024).toFixed(1);
      return Response.json({ error: `ไฟล์ใหญ่เกินไป (ไฟล์นี้ ${actualMb}MB ต้องไม่เกิน ${mb}MB)` }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffMime(bytes, file.type);
    const meta = sniffed ? ALLOWED_TYPES[sniffed] : null;
    if (!sniffed || !meta) {
      return Response.json({ error: "เนื้อไฟล์ไม่ตรงกับชนิดที่แจ้ง" }, { status: 400 });
    }
    const sniffedMaxBytes = maxBytesFor(meta.kind, settings);
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
      new File([bytes], `${randomUUID()}.${meta.ext}`, { type: sniffed }),
      // ส่งนามสกุลไปตรง ๆ — ตัวเดาของ storage รู้จักแต่รูปภาพ ถ้าไม่บอก
      // pdf/txt/zip/mp4 จะถูกเก็บเป็น .jpg แล้วเสิร์ฟกลับเป็น image/jpeg
      { ext: meta.ext }
    );
    return Response.json({ url, mime: sniffed, size: bytes.byteLength });
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
