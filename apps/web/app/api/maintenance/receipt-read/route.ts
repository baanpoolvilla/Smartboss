import { hasPermission, requireOrg } from "@smartboss/auth";

import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { createHash } from "node:crypto";

import { readReceiptImage } from "@/modules/maintenance/data/receipt-reader";
import { receiptUsedElsewhere } from "@/modules/maintenance/data/expense-tracking";
import { receiptDateWarning } from "@/modules/maintenance/lib/receipt-read";

/** อ่านใบเสร็จตอนเลือกรูปในฟอร์มค่าใช้จ่าย — เป็น route ไม่ใช่ server action เพราะไม่ใช่การบันทึก (toast กลางจะขึ้น "สำเร็จ") */
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await requireOrg();
  // คนบันทึก + คนปิดงาน (ช่างแนบใบเสร็จตอนปิดงาน)
  if (![MAINT_PERMS.expenseManage, MAINT_PERMS.workorderComplete, MAINT_PERMS.workorderManage].some((p) => hasPermission(session, p))) {
    return Response.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }
  const form = await req.formData();
  const file = form.get("receipt");
  const workOrderId = String(form.get("workOrderId") ?? "") || null;
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return Response.json({ error: "อ่านได้เฉพาะไฟล์รูป" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return Response.json({ error: "รูปใหญ่เกิน 10 MB" }, { status: 400 });
  // รูปซ้ำเตือนได้แม้ AI อ่านไม่สำเร็จ
  const warnings: string[] = [];
  const sha = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  const used = await receiptUsedElsewhere(session.orgId, sha, workOrderId).catch(() => null);
  if (used) warnings.push(`รูปนี้เคยใช้แล้วที่ ${used} ตรวจว่าไม่ได้ลงซ้ำ`);
  try {
    const data = await readReceiptImage(file);
    if (!data.isReceipt) warnings.push("รูปนี้ดูไม่เหมือนใบเสร็จหรือสลิป");
    if (data.notes) warnings.push(data.notes);
    const dateWarn = receiptDateWarning(data.paidAt);
    if (dateWarn) warnings.push(dateWarn);
    return Response.json({ data, warnings, sha });
  } catch (error) {
    console.error("[receipt-read]", error);
    return Response.json({ error: "อ่านใบเสร็จไม่สำเร็จ กรอกเองได้เลย", warnings, sha }, { status: 502 });
  }
}
