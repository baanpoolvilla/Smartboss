import "server-only";
import type { Session } from "@smartboss/auth";

import { salaryAccess } from "@/modules/salary/lib/access";
import { withSalaryTenant } from "@/modules/salary/lib/db";
import type { RequestView } from "./db";

/**
 * ยอดเงิน OT ของพนักงานประจำบอกเงินเดือนได้ (ยอด ÷ ชั่วโมง ÷ % × 240 = เงินเดือน) — ผู้ใช้กำหนด 22/10/2569:
 * "คนอื่นเห็นแค่ชั่วโมง" ⇒ เห็นยอดได้เฉพาะเจ้าตัว + CEO + คนที่ CEO เลือก (modules/salary/lib/access.ts)
 * แอดมินที่ลง OT ให้ / HR ที่อนุมัติ / คนดูทุกใบ (รวม IT) เห็นเวลา ชั่วโมง % แต่ไม่เห็นบาท
 *
 * ตัดตัวเลขทิ้งที่ฝั่งเซิร์ฟเวอร์ก่อนส่งให้หน้าเว็บ — ซ่อนแค่บนจอ ตัวเลขยังอยู่ในข้อมูลที่ส่งไป (เปิดดูโค้ดหน้าเว็บก็เห็น)
 * ใบอื่น (ค่าใช้จ่าย เบิกล่วงหน้า ค่าช่าง) และ OT คนงานรายวันไม่เกี่ยว — เหมือนเดิมทุกอย่าง
 * ตัวตัดสินใจในฝั่งเซิร์ฟเวอร์ (อนุมัติ จ่าย เส้นทาง CEO) โหลดใบใหม่เองเสมอ ไม่ใช้ข้อมูลที่ถูกตัดแล้ว
 */

export type MaskedRequest = RequestView & { payHidden: boolean };

export interface PayPrivacy {
  userId: string;
  canSeeAll: boolean;
}

export async function payPrivacy(session: Pick<Session, "userId" | "roles" | "orgId">): Promise<PayPrivacy> {
  return { userId: session.userId, canSeeAll: (await salaryAccess(session)).canEdit };
}

export const isStaffOt = (r: Pick<RequestView, "kind" | "beneficiaryKind">) => r.kind === "ot" && r.beneficiaryKind === "staff";

export function canSeePay(p: PayPrivacy, r: Pick<RequestView, "kind" | "beneficiaryKind" | "beneficiaryUserId">): boolean {
  return !isStaffOt(r) || p.canSeeAll || r.beneficiaryUserId === p.userId;
}

/** "ลง OT ให้ … ฿562.50" → "ลง OT ให้ … ฿•••" */
export const hideBaht = (text: string) => text.replace(/[−-]?฿\s?[\d,]+(?:\.\d+)?/g, "฿•••");

export function maskRequest(p: PayPrivacy, r: RequestView): MaskedRequest {
  if (canSeePay(p, r)) return { ...r, payHidden: false };
  return {
    ...r,
    payHidden: true,
    detail: hideBaht(r.detail),
    amount: 0,
    netAmount: 0,
    otBase: null,
    otBaseKind: null,
    lines: [],
    paidTotal: 0,
    payments: r.payments.map((x) => ({ ...x, amount: 0, note: hideBaht(x.note) })),
    decisionNote: r.decisionNote ? hideBaht(r.decisionNote) : r.decisionNote,
    firstDecisionNote: r.firstDecisionNote ? hideBaht(r.firstDecisionNote) : r.firstDecisionNote,
  };
}

/** ข้อความแสดงแทนยอดที่ซ่อน */
export const HIDDEN_PAY_LABEL = "เห็นเฉพาะเจ้าตัว / CEO / ผู้ดูแลเงินเดือน";

/**
 * หน้า "ส่งเข้าเงินเดือน" ของเบิกจ่าย & OT ใช้ได้ไหม — คืนเหตุผลที่ใช้ไม่ได้ หรือ null
 *   - บริษัทเริ่มใช้โมดูลเงินเดือนแล้ว (มีรอบเงินเดือนสักรอบ) → รอบเงินเดือนดึง OT/เบิกล่วงหน้าเอง
 *     ถ้ายังกดที่นี่ได้ ใบจะถูกนับว่าจ่ายผ่านเงินเดือน แล้วรอบเงินเดือนไม่ดึงมา = พนักงานไม่ได้เงินจริง
 *   - คนกดไม่ใช่ CEO/ผู้ดูแลเงินเดือน → หน้านี้แสดงยอด OT รายคน (บอกเงินเดือนได้)
 */
export async function payrollHandoffBlock(session: Pick<Session, "userId" | "roles" | "orgId">): Promise<string | null> {
  if (!session.orgId) return "ไม่มีบริษัท";
  const runs = await withSalaryTenant(session.orgId, (tx) => tx.salaryRun.count({ where: { orgId: session.orgId! } })).catch(() => 0);
  if (runs > 0) return "ตั้งแต่ใช้โมดูลเงินเดือน OT และเบิกล่วงหน้าของพนักงานประจำเข้ารอบเงินเดือนให้เองแล้ว ไม่ต้องส่งที่หน้านี้";
  if (!(await payPrivacy(session)).canSeeAll) return "หน้านี้มียอด OT รายคน (บอกเงินเดือนได้) — ทำได้เฉพาะ CEO และคนที่ CEO เลือกให้ดูแลเงินเดือน";
  return null;
}
