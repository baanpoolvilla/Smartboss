import { requireOrg } from "@smartboss/auth";

import { putFile } from "@/modules/maintenance/lib/storage";
import { sniffMime } from "@/modules/report_task/lib/upload-sniff";

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
 */
const ALLOWED_TYPES: Record<string, { ext: string; maxBytes: number }> = {
  "image/jpeg": { ext: "jpg", maxBytes: 8 * 1024 * 1024 },
  "image/png": { ext: "png", maxBytes: 8 * 1024 * 1024 },
  "image/webp": { ext: "webp", maxBytes: 8 * 1024 * 1024 },
  "image/gif": { ext: "gif", maxBytes: 8 * 1024 * 1024 },
  "application/pdf": { ext: "pdf", maxBytes: 8 * 1024 * 1024 },
  "text/plain": { ext: "txt", maxBytes: 8 * 1024 * 1024 },
  "application/zip": { ext: "zip", maxBytes: 8 * 1024 * 1024 },
  "video/mp4": { ext: "mp4", maxBytes: 25 * 1024 * 1024 },
  "video/webm": { ext: "webm", maxBytes: 25 * 1024 * 1024 },
};

export async function POST(request: Request) {
  const session = await requireOrg();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
  }

  const claimed = ALLOWED_TYPES[file.type];
  if (!claimed) {
    return Response.json({ error: "ไม่รองรับชนิดไฟล์นี้" }, { status: 400 });
  }
  if (file.size > claimed.maxBytes) {
    const mb = Math.round(claimed.maxBytes / 1024 / 1024);
    return Response.json({ error: `ไฟล์ใหญ่เกินไป (จำกัด ${mb}MB)` }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMime(bytes, file.type);
  const meta = sniffed ? ALLOWED_TYPES[sniffed] : null;
  if (!sniffed || !meta) {
    return Response.json({ error: "เนื้อไฟล์ไม่ตรงกับชนิดที่แจ้ง" }, { status: 400 });
  }

  /*
   * ตั้งชื่อใหม่จากชนิดที่ "ตรวจได้จริง" ไม่ใช่ชื่อที่ผู้ใช้ส่งมา
   * putFile เอานามสกุลจากชื่อไฟล์ไปกำหนด Content-Type ตอนเก็บ
   * ถ้าใช้ชื่อเดิม คนอัปโหลดจะเลือก Content-Type ที่ปลายทางเสิร์ฟได้เอง
   */
  const url = await putFile(
    `${session.orgId}/report-task`,
    new File([bytes], `${crypto.randomUUID()}.${meta.ext}`, { type: sniffed }),
    // ส่งนามสกุลไปตรง ๆ — ตัวเดาของ storage รู้จักแต่รูปภาพ ถ้าไม่บอก
    // pdf/txt/zip/mp4 จะถูกเก็บเป็น .jpg แล้วเสิร์ฟกลับเป็น image/jpeg
    { ext: meta.ext }
  );

  return Response.json({ url, mime: sniffed, size: bytes.byteLength });
}
