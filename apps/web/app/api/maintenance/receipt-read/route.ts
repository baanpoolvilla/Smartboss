import { hasPermission, requireOrg } from "@smartboss/auth";

import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { readReceiptImage } from "@/modules/maintenance/data/receipt-reader";

/** อ่านใบเสร็จตอนเลือกรูปในฟอร์มค่าใช้จ่าย — เป็น route ไม่ใช่ server action เพราะไม่ใช่การบันทึก (toast กลางจะขึ้น "สำเร็จ") */
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.expenseManage)) {
    return Response.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }
  const file = (await req.formData()).get("receipt");
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return Response.json({ error: "อ่านได้เฉพาะไฟล์รูป" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return Response.json({ error: "รูปใหญ่เกิน 10 MB" }, { status: 400 });
  try {
    return Response.json({ data: await readReceiptImage(file) });
  } catch (error) {
    console.error("[receipt-read]", error);
    return Response.json({ error: "อ่านใบเสร็จไม่สำเร็จ กรอกเองได้เลย" }, { status: 502 });
  }
}
