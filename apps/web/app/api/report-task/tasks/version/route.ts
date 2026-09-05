import { requireOrg } from "@smartboss/auth";

import { readTasksVersion } from "@/modules/report_task/lib/db/task-repo";

/**
 * เลขรุ่นของคอลเลกชัน Task อย่างเดียว (R1) — ให้ poll ยิงตัวนี้ก่อนทุกครั้ง
 * แทนที่จะ GET /api/report-task/tasks ทั้งก้อน (รวม comments/checklist/
 * revisions/attachment ของงานทั้งบริษัท) แล้วค่อย GET เต็มเฉพาะตอน version
 * เปลี่ยนจริง — ลด payload การ poll จากหลาย MB เหลือไม่กี่สิบไบต์
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOrg();
  const version = await readTasksVersion(session.orgId);
  return Response.json({ version }, { headers: { "Cache-Control": "no-store", "X-Data-Version": String(version) } });
}
