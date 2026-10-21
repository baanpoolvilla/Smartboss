import "server-only";
import { prisma } from "@smartboss/database";

import { usersWithPermission } from "@/modules/maintenance/data/notify";
import { REQ_PERMS } from "../permissions";
import { loadRequests, withRequestsTenant } from "./db";
import { notifyApprovers, notifyClear } from "./notify";
import { bangkokToday } from "./types";

/**
 * เตือนประจำวัน (cron "all" 08:00) — ใบค้างไม่มีใครเห็นคือปัญหาที่เจอมาแล้ว (CEO ไม่อยู่ 18/10)
 *   - รออนุมัติเกิน 24 ชม. → เตือนผู้อนุมัติซ้ำ
 *   - เบิกเงินไปก่อนเลยกำหนดเคลียร์ → เตือนคนเบิก + HR
 */
export async function remindRequests(): Promise<{ pending: number; overdueClear: number }> {
  const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });
  const today = bangkokToday();
  const out = { pending: 0, overdueClear: 0 };
  for (const org of orgs) {
    try {
      const { pending, clear } = await withRequestsTenant(org.id, async (tx) => ({
        pending: await loadRequests(tx, org.id, { status: "pending", createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } }, 200),
        clear: await loadRequests(tx, org.id, { kind: "cash_advance", status: "paid", clearStatus: null, clearDueDate: { lt: new Date(`${today}T00:00:00Z`) } }, 200),
      }));
      for (const r of pending) {
        await notifyApprovers(org.id, r, r.approverLevel, [r.createdBy, r.beneficiaryUserId ?? ""]);
        out.pending++;
      }
      if (clear.length > 0) {
        const payers = await usersWithPermission(org.id, REQ_PERMS.pay);
        for (const r of clear) {
          await notifyClear(org.id, r, [r.beneficiaryUserId, r.createdBy, ...payers.filter((p) => p !== r.beneficiaryUserId)], "เลยกำหนดส่งใบเสร็จ + เงินทอน");
          out.overdueClear++;
        }
      }
    } catch (error) {
      // บริษัทที่ยังไม่ได้ลง migration ของโมดูลนี้ / ยังไม่มีข้อมูล — ข้าม
      console.error("[requests] remind failed", org.id, error);
    }
  }
  return out;
}
