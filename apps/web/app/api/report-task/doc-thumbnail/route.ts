import { getSession } from "@smartboss/auth";

import { docThumbKey, isDocFileKey } from "@/lib/doc-thumb";
import { canServeOwnedFileKey } from "@/lib/file-access";
import { readStoredBytes, storedFileExists } from "@/lib/storage";
import { storeDocThumbnail } from "@/modules/report_task/lib/thumbnail/store-doc-thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * รูปหน้าแรกของเอกสาร — ทุกที่ที่แสดงไฟล์แนบเรียกตรงนี้ (ดู lib/doc-thumb.ts)
 *
 * มีรูปแล้ว: เด้งไปไฟล์รูป · ยังไม่มีและเป็น PDF: สร้างตอนนี้แล้วเก็บไว้ คนถัดไปได้ของเดิม
 * ไฟล์เก่าที่ตอนอัปโหลดสร้างรูปไม่สำเร็จจึงกลับมาเป็นรูปได้เองโดยไม่ต้องอัปโหลดใหม่
 *
 * Word/Excel/PowerPoint ไม่สร้างที่นี่: ต้องใช้ soffice ซึ่งหนักเกินกว่าจะรันตอนแค่เปิดดู
 * มีรูปเฉพาะที่สร้างได้ตอนอัปโหลด
 *
 * สิทธิ์เท่ากับไฟล์ต้นทางใน /api/files (lib/file-access.ts) รวมห้องจำกัดสิทธิ์และใบเบิก
 * ต้องเช็คก่อนอ่านไฟล์ คนไม่มีสิทธิ์ต้องไม่ทำให้เครื่องอ่านหรือแปลงไฟล์นั้นเลย
 * ตอบ 404/503 → ฝั่งหน้าเว็บเจอ onError แล้วแสดงการ์ดไอคอน
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.orgId) return new Response("Unauthorized", { status: 401 });

  const file = new URL(request.url).searchParams.get("file") ?? "";
  const key = file.replace(/^\/api\/files\//, "");
  const allowedPrefix = ["report-task", "chat", "company-files", "requests"].some((m) => key.startsWith(`${session.orgId}/${m}/`));
  if (key === file || key.includes("..") || !allowedPrefix || !isDocFileKey(key)) {
    return new Response("Bad request", { status: 400 });
  }
  if (!(await canServeOwnedFileKey(session, key))) return new Response("Forbidden", { status: 403 });

  const thumbKey = docThumbKey(key);
  if (!(await storedFileExists(thumbKey))) {
    if (!key.toLowerCase().endsWith(".pdf")) {
      return new Response("No thumbnail", { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
    }
    const bytes = await readStoredBytes(key);
    if (!bytes) return new Response("Not found", { status: 404 });
    if (!(await storeDocThumbnail(file, bytes, "pdf"))) {
      // อายุสั้น — เครื่องพร้อมแล้วเปิดใหม่ต้องได้รูป แต่ไม่ให้ทุกการ render ยิงซ้ำ
      return new Response("Thumbnail unavailable", { status: 503, headers: { "Cache-Control": "private, max-age=60" } });
    }
  }

  // Location แบบ relative — หลัง reverse proxy request.url อาจไม่ใช่โดเมนจริง
  return new Response(null, {
    status: 302,
    headers: { Location: `/api/files/${thumbKey}`, "Cache-Control": "private, max-age=86400" },
  });
}
