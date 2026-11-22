/**
 * กติกาลดงาน HR ของเบิกจ่าย/เงินสดย่อย (ผู้ใช้ 22/11/2569) — ฟังก์ชันล้วน ไม่แตะฐานข้อมูล ทดสอบได้
 *
 *   วงเงินรายคน (ลอกแนว Ramp "Spend Program" + Brex "ผ่านเองถ้าอยู่ในนโยบาย")
 *     HR ตั้งครั้งเดียว: ใบประเภทไหน · หมวดไหน · ครั้งละไม่เกิน · ต่อสัปดาห์ไม่เกิน · ใครใช้ได้
 *     ใบที่อยู่ในวงเงินผ่านเองตอนยื่น ไม่ต้องรอใครกด · เกิน = ไปหาคนอนุมัติตามปกติ
 *   ใบรับรองแทนใบเสร็จ (บก.111) — ร้านไม่มีบิล กรอกในมือถือ + รูปของ · ใบละไม่เกินที่บริษัทตั้ง
 *   ปิดเคลียร์เองเมื่อยอดตรง — ใบเสร็จ + เงินทอน = ที่จ่ายไป และยอดที่ระบบอ่านจากใบเสร็จตรงกับที่กรอก
 */

import { PETTY_CATEGORIES, round2, type RequestKind } from "./types";

/* ───────────── วงเงินรายคน ───────────── */

/** ใบที่ใช้วงเงินได้ — ของที่คนจ่ายไปซื้อ (OT/เบิกล่วงหน้า/ค่าช่าง ไม่ใช่) */
export const LIMIT_KINDS = ["cash_advance", "expense"] as const satisfies readonly RequestKind[];
export type LimitKind = (typeof LIMIT_KINDS)[number];

export interface SpendLimitRule {
  id: string;
  name: string;
  kinds: LimitKind[];
  /** ว่าง = ทุกหมวด */
  categories: string[];
  perRequest: number;
  perWeek: number;
  userIds: string[];
  active: boolean;
}

const CATS = new Set<string>(PETTY_CATEGORIES);

/** อ่านจากฐานข้อมูล/ฟอร์ม — ค่าที่ผิดตัดทิ้ง (กฎที่ไม่มีคนหรือเพดานเป็น 0 ไม่มีผล) */
export function parseSpendLimits(value: unknown): SpendLimitRule[] {
  if (!Array.isArray(value)) return [];
  const out: SpendLimitRule[] = [];
  for (const raw of value.slice(0, 30)) {
    const r = raw as Partial<SpendLimitRule>;
    const id = typeof r?.id === "string" && /^[a-z0-9-]{4,40}$/i.test(r.id) ? r.id : null;
    const name = String(r?.name ?? "").trim().slice(0, 60);
    const perRequest = round2(Number(r?.perRequest));
    const perWeek = round2(Number(r?.perWeek));
    if (!id || !name || !(perRequest > 0) || !(perWeek > 0) || perRequest > 1_000_000 || perWeek > 1_000_000) continue;
    const kinds = (Array.isArray(r.kinds) ? r.kinds : []).filter((k): k is LimitKind => (LIMIT_KINDS as readonly string[]).includes(k));
    if (kinds.length === 0) continue;
    out.push({
      id,
      name,
      kinds: [...new Set(kinds)],
      categories: [...new Set((Array.isArray(r.categories) ? r.categories : []).filter((c): c is string => typeof c === "string" && CATS.has(c)))],
      perRequest,
      perWeek: Math.max(perWeek, perRequest),
      userIds: [...new Set((Array.isArray(r.userIds) ? r.userIds : []).filter((u): u is string => typeof u === "string" && u.length > 0 && u.length < 80))].slice(0, 500),
      active: r.active !== false,
    });
  }
  return out;
}

/** วันจันทร์ของสัปดาห์ (YYYY-MM-DD) — สัปดาห์ จ.–อา. ตามวันที่ไทย */
export function weekStartOf(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // จันทร์ = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface LimitContext {
  kind: RequestKind;
  category: string | null;
  amount: number;
  beneficiaryUserId: string | null;
  /** ยอดของคนนี้ในสัปดาห์นี้ที่นับวงเงินแล้ว (ต่อกฎ) */
  usedThisWeek: (rule: SpendLimitRule) => number;
  /** เหตุที่ใช้วงเงินไม่ได้แม้อยู่ในเพดาน (เช่น ต้องผ่าน CEO / เป็นใบของคนอนุมัติ / ค้างเคลียร์) */
  blockedBecause: string | null;
}

export interface LimitResult {
  /** กฎที่ทำให้ผ่านเอง — null = ไม่ผ่านเอง */
  rule: SpendLimitRule | null;
  /** กฎของคนนี้ที่ตรงประเภท/หมวด (ไว้แสดงวงเงินคงเหลือ) */
  shown: { rule: SpendLimitRule; used: number; left: number } | null;
  /** ทำไมไม่ผ่านเอง (แสดงในหน้ายื่น) — null = ผ่าน หรือไม่มีวงเงินเลย */
  reason: string | null;
}

/**
 * ใบนี้ผ่านเองด้วยวงเงินไหม — กฎแรกที่ตรง (คน + ประเภท + หมวด) และไม่เกินทั้งครั้งละและต่อสัปดาห์
 * ไม่มีกฎของคนนี้ = ไม่ผ่านเอง (ไปหาคนอนุมัติตามปกติ ไม่มีอะไรเปลี่ยน)
 */
export function evaluateLimit(rules: SpendLimitRule[], ctx: LimitContext): LimitResult {
  const mine = rules.filter(
    (r) =>
      r.active &&
      !!ctx.beneficiaryUserId &&
      r.userIds.includes(ctx.beneficiaryUserId) &&
      (r.kinds as readonly string[]).includes(ctx.kind),
  );
  if (mine.length === 0) return { rule: null, shown: null, reason: null };
  const fitting = mine.filter((r) => r.categories.length === 0 || (ctx.category !== null && r.categories.includes(ctx.category)));
  if (fitting.length === 0) {
    return { rule: null, shown: null, reason: ctx.category ? `หมวด “${ctx.category}” ไม่อยู่ในวงเงิน — รอคนอนุมัติ` : "เลือกหมวดก่อน ถึงจะรู้ว่าอยู่ในวงเงินไหม" };
  }
  let firstShown: LimitResult["shown"] = null;
  let reason: string | null = null;
  for (const rule of fitting) {
    const used = round2(ctx.usedThisWeek(rule));
    const left = round2(Math.max(0, rule.perWeek - used));
    firstShown ??= { rule, used, left };
    if (ctx.amount > rule.perRequest + 0.005) {
      reason ??= `เกินครั้งละ ${rule.perRequest.toLocaleString("th-TH")} บาท ของวงเงิน “${rule.name}” — รอคนอนุมัติ`;
      continue;
    }
    if (ctx.amount > left + 0.005) {
      reason ??= `วงเงินสัปดาห์นี้เหลือ ${left.toLocaleString("th-TH")} บาท ไม่พอ — รอคนอนุมัติ`;
      continue;
    }
    if (ctx.blockedBecause) return { rule: null, shown: { rule, used, left }, reason: ctx.blockedBecause };
    return { rule, shown: { rule, used, left }, reason: null };
  }
  return { rule: null, shown: firstShown, reason };
}

/* ───────────── ใบรับรองแทนใบเสร็จ ───────────── */

export interface NoReceipt {
  /** วันที่ซื้อ */
  date: string;
  /** ชื่อร้าน/คนขาย + ที่อยู่หรือที่ตั้งร้าน (ถ้ามี) */
  seller: string;
  sellerAddress: string;
  items: { item: string; amount: number }[];
  total: number;
  /** ทำไมไม่มีบิล */
  reason: string;
  /** คนรับรอง = คนที่จ่ายเงิน */
  signedName: string;
  signedAt: string;
}

export const NO_RECEIPT_REASONS = ["ร้านตลาด / แผงลอย ไม่มีบิล", "ร้านเล็ก ออกใบเสร็จไม่ได้", "ค่าบริการ/ค่าแรงรายวัน ไม่มีบิล", "อื่น ๆ"] as const;

/** ตรวจใบรับรองที่ส่งมา — ผิด = ข้อความ · ถูก = ใบที่ทำความสะอาดแล้ว */
export function cleanNoReceipt(
  raw: unknown,
  ctx: { max: number | null; signedName: string; today: string; expectTotal?: number },
): { error: string } | { value: NoReceipt } {
  if (ctx.max === null) return { error: "บริษัทยังไม่เปิดให้ใช้ใบรับรองแทนใบเสร็จ — ตั้งได้ที่ ตั้งค่าเบิกจ่าย" };
  const r = (raw ?? {}) as Partial<NoReceipt>;
  const date = String(r.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > ctx.today) return { error: "ใบรับรอง: วันที่ซื้อไม่ถูกต้อง" };
  const seller = String(r.seller ?? "").trim().slice(0, 120);
  if (!seller) return { error: "ใบรับรอง: ใส่ชื่อร้านหรือคนขาย" };
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((x) => ({ item: String(x?.item ?? "").trim().slice(0, 120), amount: round2(Number(x?.amount)) }))
    .filter((x) => x.item && Number.isFinite(x.amount) && x.amount > 0)
    .slice(0, 20);
  if (items.length === 0) return { error: "ใบรับรอง: ใส่รายการที่ซื้ออย่างน้อย 1 รายการ" };
  const total = round2(items.reduce((s, x) => s + x.amount, 0));
  if (total > ctx.max + 0.005) return { error: `ใบรับรองแทนใบเสร็จใช้ได้ใบละไม่เกิน ${ctx.max.toLocaleString("th-TH")} บาท — ยอดเกินต้องมีบิลจริง` };
  if (ctx.expectTotal !== undefined && Math.abs(total - ctx.expectTotal) > 0.005) {
    return { error: `ใบรับรอง: รวมรายการ ${total.toLocaleString("th-TH")} บาท ไม่ตรงกับยอด ${ctx.expectTotal.toLocaleString("th-TH")} บาท` };
  }
  const reason = String(r.reason ?? "").trim().slice(0, 120) || NO_RECEIPT_REASONS[0];
  return {
    value: { date, seller, sellerAddress: String(r.sellerAddress ?? "").trim().slice(0, 200), items, total, reason, signedName: ctx.signedName, signedAt: new Date().toISOString() },
  };
}

export function parseNoReceipt(value: unknown): NoReceipt | null {
  if (!value || typeof value !== "object") return null;
  const r = value as NoReceipt;
  return typeof r.seller === "string" && Array.isArray(r.items) && typeof r.total === "number" ? r : null;
}

/* ───────────── ปิดเคลียร์เองเมื่อยอดตรง ───────────── */

/**
 * ส่งใบเสร็จแล้ว "ยอดตรง" ไหม: ใช้จริง + เงินทอน = ที่ได้ไป และ
 *   มีใบรับรองแทนใบเสร็จที่ยอดเท่าที่ใช้ หรือ ทุกใบเสร็จระบบอ่านยอดได้ รวมแล้วต่างจากที่กรอกไม่เกิน 1 บาท
 * ไม่ตรง/อ่านไม่ได้ = HR ตรวจเหมือนเดิม
 */
export function clearingMatches(c: {
  paid: number;
  spent: number;
  returned: number;
  receiptAmounts: (number | null | undefined)[];
  noReceiptTotal: number | null;
}): boolean {
  if (Math.abs(round2(c.spent + c.returned) - round2(c.paid)) > 0.005) return false;
  if (c.spent <= 0) return c.receiptAmounts.length === 0 && c.noReceiptTotal === null;
  if (c.noReceiptTotal !== null) {
    const read = c.receiptAmounts.filter((x): x is number => typeof x === "number" && x > 0);
    return Math.abs(round2(c.noReceiptTotal + read.reduce((s, x) => s + x, 0)) - c.spent) <= 1;
  }
  if (c.receiptAmounts.length === 0) return false;
  const read = c.receiptAmounts.filter((x): x is number => typeof x === "number" && x > 0);
  if (read.length !== c.receiptAmounts.length) return false;
  return Math.abs(round2(read.reduce((s, x) => s + x, 0)) - c.spent) <= 1;
}

/* ───────────── รายการหลายบ้าน ───────────── */

export interface RequestLine {
  item: string;
  amount: number;
  propertyId?: string | null;
  propertyName?: string | null;
}

/** ยอดต่อบ้านของใบที่แยกบ้านต่อรายการ — รายการที่ไม่ได้เลือกบ้านใช้บ้านของใบ */
export function amountsByProperty(lines: RequestLine[], fallback: { id: string | null; name: string | null }): { id: string | null; name: string; amount: number }[] {
  const map = new Map<string, { id: string | null; name: string; amount: number }>();
  for (const l of lines) {
    const id = l.propertyId ?? fallback.id;
    const name = l.propertyName ?? fallback.name ?? "ไม่ระบุบ้าน";
    const key = id ?? "-";
    const cur = map.get(key) ?? { id, name, amount: 0 };
    cur.amount = round2(cur.amount + l.amount);
    map.set(key, cur);
  }
  return [...map.values()];
}
