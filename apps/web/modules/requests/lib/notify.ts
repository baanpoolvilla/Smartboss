import "server-only";
import { prisma } from "@smartboss/database";

import { notifyUsers, usersWithPermission } from "@/modules/maintenance/data/notify";
import { REQ_PERMS } from "../permissions";
import { KIND_META, baht, type ApproverLevel, type RequestKind } from "./types";

/**
 * แจ้งเตือนของเบิกจ่าย & OT — ทุกชนิดขึ้นต้น "req_" (ลิงก์ไป /requests/<id> ดู notifications/derive.ts)
 *   req_pending  → ผู้อนุมัติ (หายจากทุกคนเมื่อมีคนตัดสินแล้ว)
 *   req_to_pay   → คนจ่ายเงิน (หายจากทุกคนเมื่อจ่ายครบ)
 *   req_result   → คนยื่น + ผู้ได้เงิน (อนุมัติ/ไม่อนุมัติ/จ่ายแล้ว)
 *   req_clear    → เตือนเคลียร์เงินที่เบิกไปก่อน / HR ตรวจเคลียร์
 */

interface Brief {
  id: string;
  code: string;
  kind: RequestKind;
  title: string;
  netAmount: number;
  beneficiaryName: string;
}

const head = (r: Brief) => `${r.code} · ${KIND_META[r.kind].short} ${baht(r.netAmount)}`;

export async function notifyApprovers(orgId: string, r: Brief, level: ApproverLevel, exclude: string[]) {
  const ids = await usersWithPermission(orgId, level === "ceo" ? REQ_PERMS.approveCeo : REQ_PERMS.approve);
  await notifyUsers(
    orgId,
    ids.filter((id) => !exclude.includes(id)),
    { title: `รออนุมัติ: ${head(r)}`, body: `${r.beneficiaryName} · ${r.title}`, type: "req_pending", referenceId: r.id },
  );
}

export async function notifyPayers(orgId: string, r: Brief, exclude: string[]) {
  const ids = await usersWithPermission(orgId, REQ_PERMS.pay);
  await notifyUsers(
    orgId,
    ids.filter((id) => !exclude.includes(id)),
    { title: `รอจ่าย: ${head(r)}`, body: `${r.beneficiaryName} · ${r.title}`, type: "req_to_pay", referenceId: r.id },
  );
}

export async function notifyResult(orgId: string, r: Brief, userIds: (string | null)[], title: string, body?: string) {
  await notifyUsers(orgId, userIds, { title: `${title}: ${head(r)}`, body: body ?? r.title, type: "req_result", referenceId: r.id });
}

export async function notifyClear(orgId: string, r: Brief, userIds: (string | null)[], title: string) {
  await notifyUsers(orgId, userIds, { title: `${title}: ${head(r)}`, body: r.title, type: "req_clear", referenceId: r.id });
}

/** งานที่รอ "ใครก็ได้ในกลุ่ม" ทำ — พอมีคนทำแล้ว แจ้งเตือนนั้นหายจากทุกคน (ไม่ค้างแดงให้คนอื่น) */
export async function clearActionNotifications(orgId: string, requestId: string, types: string[]) {
  try {
    await prisma.notification.updateMany({
      where: { orgId, referenceId: requestId, type: { in: types }, readAt: null },
      data: { readAt: new Date() },
    });
  } catch (error) {
    console.error("[requests] clearActionNotifications failed", error);
  }
}
