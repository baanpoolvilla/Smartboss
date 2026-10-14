import { requireOrg } from "@smartboss/auth";

import { loadScorePeriodConfig } from "@/lib/score-period-config";

/**
 * วันตัดรอบเกรดของบริษัท (อ่านอย่างเดียว) — ให้แดชบอร์ดรายงานตัดช่วงส่งย้อนหลังที่วันตัดรอบเหมือนตัวหักคะแนน
 * ไม่ใส่ "score-period" ใน store-registry โดยตั้งใจ — ไม่งั้นพนักงานคนไหนก็ PUT ทับวันตัดรอบได้
 * (แก้ได้ที่ /admin/performance/settings เท่านั้น)
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOrg();
  const { cutoffDay, overrides, calendarMonthsUntil } = await loadScorePeriodConfig(session.orgId);
  return Response.json({ cutoffDay, overrides, calendarMonthsUntil });
}
