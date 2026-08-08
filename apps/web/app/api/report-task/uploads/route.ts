import { requireOrg } from "@smartboss/auth";

import { putFile } from "@/modules/maintenance/lib/storage";

/**
 * อัปโหลดรูปของโมดูลรายงานและงาน
 *
 * ต้นทางเขียนลง `public/uploads/` ตรง ๆ ซึ่งใช้ไม่ได้ในระบบนี้:
 *   - ไฟล์ปนกันทุกบริษัท และเข้าถึงได้โดยไม่ต้อง login (อยู่ใต้ public/)
 *   - serverless เขียนดิสก์ไม่ได้
 *
 * เปลี่ยนมาใช้ชั้นเก็บไฟล์กลางของ Smartboss ซึ่งสลับ S3/ดิสก์ตาม env ให้เอง
 * และคืน URL รูปแบบ `/api/files/<key>` ที่ **ต้อง login** ถึงจะเปิดได้
 * โดย key นำหน้าด้วย orgId ⇒ ไฟล์ของแต่ละบริษัทแยกโฟลเดอร์กัน
 *
 * ฝั่ง client เก็บแค่สตริง URL ที่ได้กลับไป จึงไม่ต้องแก้ UI
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  const session = await requireOrg();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json(
      { error: "รองรับเฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "ไฟล์ใหญ่เกินไป (จำกัด 8MB)" }, { status: 413 });
  }

  const url = await putFile(`${session.orgId}/report-task`, file);
  return Response.json({ url });
}
