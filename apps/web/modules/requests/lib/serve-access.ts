import "server-only";
import type { Session } from "@smartboss/auth";
import { hasPermission } from "@smartboss/auth";

import { REQ_PERMS } from "../permissions";
import { withRequestsTenant } from "./db";

/**
 * ไฟล์แนบของเบิกจ่าย & OT (`<orgId>/requests/<uploaderId>/...`) — ใบเสร็จ/สลิปมีเลขบัญชี ชื่อร้าน
 * เหตุผลส่วนตัว จึงไม่เปิดให้ทุกคนในบริษัทแค่เพราะมี URL (ผู้ใช้ตกลง 21/10/2569):
 *   - คนอัปโหลดเอง (ยังไม่ได้ส่งใบก็เห็นรูปตัวอย่างได้)
 *   - ผู้อนุมัติ / ผู้จ่าย / คนถือเงินสดย่อย / ผู้ดูทั้งหมด
 *   - คนยื่น หรือผู้ได้เงิน ของใบที่มีไฟล์นี้
 */
export async function canServeRequestFileKey(orgId: string, session: Session, key: string): Promise<boolean> {
  const parts = key.split("/");
  if (parts[2] && parts[2] === session.userId) return true;
  const staff = [REQ_PERMS.viewAll, REQ_PERMS.approve, REQ_PERMS.approveCeo, REQ_PERMS.pay, REQ_PERMS.pettyCash];
  if (staff.some((p) => hasPermission(session, p))) return true;
  const url = `/api/files/${key}`;
  const rows = await withRequestsTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT 1 AS n FROM requests.requests r
        WHERE r.org_id = $1 AND (r.created_by = $2 OR r.beneficiary_user_id = $2)
          AND (r.attachments @> jsonb_build_array(jsonb_build_object('url', $3::text))
               OR EXISTS (SELECT 1 FROM requests.payments p WHERE p.request_id = r.id AND p.slips @> jsonb_build_array(jsonb_build_object('url', $3::text))))
        LIMIT 1`,
      orgId,
      session.userId,
      url,
    ),
  ).catch(() => []);
  return rows.length > 0;
}
