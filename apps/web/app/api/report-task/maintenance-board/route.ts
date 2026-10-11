import { requireOrg } from "@smartboss/auth";

import { listMaintenanceBoardItems } from "@/modules/report_task/lib/db/maintenance-board";

/**
 * ใบงานซ่อม + สั่งซื้ออุปกรณ์ที่คนนี้เห็น สำหรับแสดงบนบอร์ดงาน (อ่านอย่างเดียว) — ดู lib/db/maintenance-board.ts
 * ไม่มีสิทธิ์ดูแจ้งซ่อม = รายการว่าง (ไม่ใช่ 403 — บอร์ดงานยังใช้ได้ปกติ)
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOrg();
  try {
    const items = await listMaintenanceBoardItems(session);
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[report-task/maintenance-board]", err);
    return Response.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
