import "server-only";

import { loadRequests, num0, toPetty, withRequestsTenant, type PettyEntryView, type RequestView } from "./db";
import { shiftMonthOf } from "./types";

/**
 * สรุปเงินสดย่อยรายเดือน (ผู้ใช้ 31/10/2569 "สรุปรายจ่ายในเดือนนั้น จ่าย เติม อะไรเท่าไหร่ + ดูได้ว่าจ่ายให้ยอดไหน + Excel")
 * เดือน = เดือนปฏิทินตามเวลาไทย นับจากเวลาที่ลงรายการ · รายการที่ยกเลิกแล้วไม่นับ (แต่ยังแสดงในประวัติ)
 * ยกมา = ผลรวมทุกรายการก่อนต้นเดือน · คงเหลือ = ยกมา + ทุกอย่างในเดือน
 */
export interface PettyMonthRow {
  userId: string;
  name: string;
  opening: number;
  topUp: number;
  /** จ่ายตามใบเบิก (ยอดบวก) */
  paidRequests: number;
  /** ซื้อของเอง ไม่มีใบเบิก (ยอดบวก) */
  selfSpend: number;
  /** รับเงินทอนคืน + ปรับยอด (± ตามจริง) */
  other: number;
  closing: number;
}

export interface PettyMonthEntry extends PettyEntryView {
  requestCode: string | null;
  /** ใบเบิก: จ่ายให้ใคร */
  paidTo: string | null;
}

export interface PettyMonth {
  rows: PettyMonthRow[];
  /** ภาษีจาก "ซื้อของเอง" ในเดือน (ไม่นับที่ยกเลิก) — VAT ซื้อ + หัก ณ ที่จ่ายที่บริษัทต้องนำส่ง แยกแบบ */
  tax: { vat: number; wht3: number; wht53: number; whtCount: number };
  /** "ซื้อของเอง" ที่ยังไม่จบการตรวจ (ทุกเดือน ณ ตอนนี้ ไม่ใช่เฉพาะเดือนที่เลือก) */
  review: { pendingCount: number; pendingAmount: number; shortCount: number; shortAmount: number };
  byCategory: { category: string; amount: number }[];
  entries: PettyMonthEntry[];
}

/** ช่วงเวลาของเดือนตามเวลาไทย */
export function monthBounds(month: string): { start: Date; end: Date } {
  return { start: new Date(`${month}-01T00:00:00+07:00`), end: new Date(`${shiftMonthOf(month, 1)}-01T00:00:00+07:00`) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function pettyMonth(orgId: string, month: string, holders: { userId: string; name: string }[], onlyHolder?: string): Promise<PettyMonth> {
  const { start, end } = monthBounds(month);
  const ids = holders.map((h) => h.userId);
  return withRequestsTenant(orgId, async (tx) => {
    const [before, rows, open] = await Promise.all([
      tx.moneyPettyCashEntry.groupBy({ by: ["holderUserId"], where: { orgId, voidedAt: null, createdAt: { lt: start }, holderUserId: { in: ids } }, _sum: { delta: true } }),
      tx.moneyPettyCashEntry.findMany({ where: { orgId, createdAt: { gte: start, lt: end }, holderUserId: { in: ids } }, orderBy: { createdAt: "desc" } }),
      tx.moneyPettyCashEntry.findMany({
        where: { orgId, voidedAt: null, reviewStatus: { in: ["pending", "rejected"] }, holderUserId: { in: onlyHolder ? [onlyHolder] : ids } },
        select: { reviewStatus: true, delta: true },
      }),
    ]);
    const requestIds = [...new Set(rows.map((e) => e.requestId).filter((x): x is string => !!x))];
    const reqs = requestIds.length
      ? await tx.moneyRequest.findMany({ where: { orgId, id: { in: requestIds } }, select: { id: true, code: true, beneficiaryName: true } })
      : [];
    const reqOf = new Map(reqs.map((r) => [r.id, r]));
    const opening = new Map(before.map((b) => [b.holderUserId, num0(b._sum.delta)]));

    const sums = new Map<string, PettyMonthRow>(
      holders.map((h) => [h.userId, { userId: h.userId, name: h.name, opening: opening.get(h.userId) ?? 0, topUp: 0, paidRequests: 0, selfSpend: 0, other: 0, closing: 0 }]),
    );
    const cats = new Map<string, number>();
    const tax = { vat: 0, wht3: 0, wht53: 0, whtCount: 0 };
    for (const e of rows) {
      if (e.voidedAt) continue;
      if ((!onlyHolder || e.holderUserId === onlyHolder) && e.billAmount !== null) {
        tax.vat += num0(e.vatAmount);
        const w = num0(e.whtAmount);
        if (w > 0) {
          tax.whtCount++;
          if (e.payeeKind === "company") tax.wht53 += w;
          else tax.wht3 += w;
        }
      }
      const row = sums.get(e.holderUserId);
      if (!row) continue;
      const d = num0(e.delta);
      if (e.kind === "top_up") row.topUp += d;
      else if (e.kind === "spend" && e.requestId) row.paidRequests -= d;
      else if (e.kind === "spend") {
        row.selfSpend -= d;
        if (!onlyHolder || e.holderUserId === onlyHolder) cats.set(e.category ?? "ไม่ระบุหมวด", (cats.get(e.category ?? "ไม่ระบุหมวด") ?? 0) - d);
      } else row.other += d;
    }
    const out = [...sums.values()].map((r) => {
      const x = { ...r, topUp: round2(r.topUp), paidRequests: round2(r.paidRequests), selfSpend: round2(r.selfSpend), other: round2(r.other) };
      return { ...x, closing: round2(x.opening + x.topUp - x.paidRequests - x.selfSpend + x.other) };
    });
    const pend = open.filter((e) => e.reviewStatus === "pending");
    const short = open.filter((e) => e.reviewStatus === "rejected");
    return {
      rows: out,
      tax: { vat: round2(tax.vat), wht3: round2(tax.wht3), wht53: round2(tax.wht53), whtCount: tax.whtCount },
      review: {
        pendingCount: pend.length,
        pendingAmount: round2(pend.reduce((t, e) => t - num0(e.delta), 0)),
        shortCount: short.length,
        shortAmount: round2(short.reduce((t, e) => t - num0(e.delta), 0)),
      },
      byCategory: [...cats.entries()].map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
      entries: rows
        .filter((e) => !onlyHolder || e.holderUserId === onlyHolder)
        .map((e) => {
          const r = e.requestId ? reqOf.get(e.requestId) : undefined;
          return { ...toPetty(e), requestCode: r?.code ?? null, paidTo: r?.beneficiaryName ?? null };
        }),
    };
  });
}

/**
 * เงินออกทั้งหมดของเดือน — หน้ารายงานเบิกจ่าย (ผู้ใช้ 31/10/2569 "ยอดจ่ายทั้งหมดในเดือนนั้น")
 *   จ่ายตามใบเบิก = การจ่ายที่ลงวันที่จ่ายในเดือนนี้ แยกจากเงินสดย่อย / ทางอื่น (โอน เงินสด รวมเงินเดือน ค่าแรง)
 *   ซื้อของเองจากเงินสดย่อย = รายการ "จ่ายเงิน" ที่ไม่มีใบเบิก (ใบที่จ่ายจากเงินสดย่อยนับครั้งเดียวในแถวแรก)
 * การเติมเงินสดย่อยไม่ใช่รายจ่าย (ย้ายเงินบริษัทไปไว้ในมือคนถือ) · ใบที่ซ่อนยอด (OT พนักงาน) ไม่นับ — บอกจำนวนแยก
 */
export interface MoneyOut {
  viaPetty: number;
  viaOther: number;
  selfSpend: number;
  total: number;
  hiddenCount: number;
}

export async function moneyOutOfMonth(orgId: string, month: string, isHidden: (r: RequestView) => boolean): Promise<MoneyOut> {
  const { start, end } = monthBounds(month);
  return withRequestsTenant(orgId, async (tx) => {
    const [pays, spends] = await Promise.all([
      tx.moneyRequestPayment.findMany({
        where: { orgId, voidedAt: null, paidOn: { gte: new Date(`${month}-01T00:00:00Z`), lt: new Date(`${shiftMonthOf(month, 1)}-01T00:00:00Z`) } },
        select: { requestId: true, amount: true, method: true },
      }),
      tx.moneyPettyCashEntry.aggregate({ where: { orgId, voidedAt: null, kind: "spend", requestId: null, createdAt: { gte: start, lt: end } }, _sum: { delta: true } }),
    ]);
    const reqIds = [...new Set(pays.map((p) => p.requestId))];
    const reqs = new Map((reqIds.length ? await loadRequests(tx, orgId, { id: { in: reqIds } }, reqIds.length) : []).map((r) => [r.id, r]));
    let viaPetty = 0;
    let viaOther = 0;
    const hidden = new Set<string>();
    for (const p of pays) {
      const r = reqs.get(p.requestId);
      if (r && isHidden(r)) {
        hidden.add(p.requestId);
        continue;
      }
      if (p.method === "petty_cash") viaPetty += num0(p.amount);
      else viaOther += num0(p.amount);
    }
    const selfSpend = -num0(spends._sum.delta);
    return { viaPetty: round2(viaPetty), viaOther: round2(viaOther), selfSpend: round2(selfSpend), total: round2(viaPetty + viaOther + selfSpend), hiddenCount: hidden.size };
  });
}
