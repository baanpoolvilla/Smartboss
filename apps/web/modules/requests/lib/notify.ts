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

// OT ไม่ใส่ยอดเงินในแจ้งเตือน — ยอด OT บอกเงินเดือนได้ และแจ้งเตือนขึ้นบนหน้าจอล็อกให้คนข้าง ๆ เห็น (lib/pay-privacy.ts)
const head = (r: Brief) => (r.kind === "ot" ? `${r.code} · ${KIND_META[r.kind].short}` : `${r.code} · ${KIND_META[r.kind].short} ${baht(r.netAmount)}`);

/**
 * คนที่ต้องได้แจ้งเตือน "รออนุมัติ" ของขั้นนี้ — ระดับ HR แจ้ง HR เท่านั้น ไม่แจ้ง CEO ทุกใบ
 * ("ไม่อยากให้ CEO อนุมัติเยอะ" 21/10/2569 — CEO ถือสิทธิ์อนุมัติระดับ HR ด้วย จึงต้องตัดออกเอง)
 * ไม่มี HR ที่อนุมัติใบนี้ได้ (เช่น HR เป็นคนยื่น/ผู้ได้เงินเอง) → แจ้ง CEO แทน ไม่ให้ใบค้างเงียบ
 */
export async function approverRecipients(orgId: string, level: ApproverLevel, exclude: string[]): Promise<string[]> {
  const ceo = await usersWithPermission(orgId, REQ_PERMS.approveCeo);
  if (level === "ceo") return ceo.filter((id) => !exclude.includes(id));
  const ceoSet = new Set(ceo);
  const hr = (await usersWithPermission(orgId, REQ_PERMS.approve)).filter((id) => !exclude.includes(id));
  const pureHr = hr.filter((id) => !ceoSet.has(id));
  return pureHr.length > 0 ? pureHr : hr;
}

export async function notifyApprovers(orgId: string, r: Brief, level: ApproverLevel, exclude: string[], prefix = "รออนุมัติ") {
  await notifyUsers(
    orgId,
    await approverRecipients(orgId, level, exclude),
    { title: `${prefix}: ${head(r)}`, body: `${r.beneficiaryName} · ${r.title}`, type: "req_pending", referenceId: r.id },
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

/**
 * เงินสดย่อย — คำขอเติมเงิน (type petty_topup ลิงก์ไป /requests/petty-cash · notifications/derive.ts)
 * needsCeo = ผู้ถือเป็น HR ⇒ แจ้ง CEO เท่านั้น · ไม่งั้นแจ้ง HR (ไม่มี HR ที่อนุมัติได้ → CEO) · ไม่แจ้งตัวผู้ถือเอง
 */
export async function notifyPettyTopupApprovers(orgId: string, t: { id: string; holderUserId: string; holderName: string; amount: number; note: string; needsCeo: boolean }) {
  const ids = t.needsCeo
    ? (await usersWithPermission(orgId, REQ_PERMS.approveCeo)).filter((id) => id !== t.holderUserId)
    : await approverRecipients(orgId, "hr", [t.holderUserId]);
  await notifyUsers(orgId, ids, {
    title: `ขอเติมเงินสดย่อย: ${t.holderName} ${baht(t.amount)}`,
    body: t.note || "รออนุมัติ — แนบสลิปโอน/รูปเงินสดตอนอนุมัติ",
    type: "petty_topup",
    referenceId: t.id,
  });
}

export async function notifyPettyTopupResult(orgId: string, userIds: (string | null)[], title: string, body: string) {
  await notifyUsers(orgId, userIds, { title, body, type: "petty_topup" });
}
