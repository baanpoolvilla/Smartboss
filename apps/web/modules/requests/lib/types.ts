/**
 * กติกาบริสุทธิ์ของโมดูลเบิกจ่าย & OT (ไม่แตะฐานข้อมูล — ทดสอบได้ตรง ๆ ดู types.test.ts)
 * ตัวเลขเงินทุกตัวที่หน้าจอแสดงมาจากฟังก์ชันในไฟล์นี้ ไม่คำนวณซ้ำในหน้าเว็บ
 */

export type RequestKind = "ot" | "advance" | "expense" | "cash_advance" | "contractor";
export type RequestStatus = "pending" | "approved" | "rejected" | "paid" | "cancelled";
export type ApproverLevel = "hr" | "ceo";
export type BeneficiaryKind = "staff" | "worker" | "vendor";
export type PaymentMethod = "transfer" | "cash" | "petty_cash" | "payroll" | "worker_ledger";
export type AttachmentRole = "evidence" | "receipt" | "slip" | "clearing";

export const KINDS: RequestKind[] = ["ot", "expense", "cash_advance", "advance", "contractor"];

export const KIND_META: Record<
  RequestKind,
  { label: string; short: string; who: string; approver: string; hint: string }
> = {
  ot: {
    label: "OT / งานนอกเวลา",
    short: "OT",
    who: "แอดมินลงให้ (เจ้าตัวลงเองไม่ได้)",
    approver: "HR ตรวจว่ามีจริง (ยอดสูง → CEO)",
    hint: "พนักงาน ช่าง หรือคนงานที่ถูกเรียกมาทำงานนอกเวลา",
  },
  expense: {
    label: "เบิกค่าใช้จ่าย",
    short: "ค่าใช้จ่าย",
    who: "ยื่นเอง พร้อมใบเสร็จ",
    approver: "HR อนุมัติและจ่าย (ยอดสูง → CEO)",
    hint: "ทางด่วน น้ำมัน ซื้อของ ที่จ่ายเงินตัวเองไปก่อน",
  },
  cash_advance: {
    label: "เบิกเงินไปซื้อของ",
    short: "เบิกไปซื้อของ",
    who: "ยื่นเอง ซื้อเสร็จส่งใบเสร็จ + เงินทอน",
    approver: "HR อนุมัติและจ่าย (ยอดสูง → CEO)",
    hint: "ต้องได้เงินก่อนไปซื้อ — ซื้อเสร็จส่งใบเสร็จและคืนเงินทอน",
  },
  advance: {
    label: "เบิกล่วงหน้า",
    short: "เบิกล่วงหน้า",
    who: "ผู้ดูแลบ้าน / HR ขอให้",
    approver: "HR อนุมัติ (ยอดสูง → CEO)",
    hint: "ขอเงินก่อนเงินเดือน/ค่าแรงออก — หักคืนจากเงินเดือน/ค่าแรงทีหลัง",
  },
  contractor: {
    label: "ค่าช่าง/ร้านภายนอก",
    short: "ช่างภายนอก",
    who: "แอดมินลง",
    approver: "HR อนุมัติและจ่าย (ยอดสูง → CEO)",
    hint: "จ้างช่างหรือร้านข้างนอก — ระบบคิด VAT และภาษีหัก ณ ที่จ่ายให้",
  },
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  transfer: "โอนเข้าบัญชี",
  cash: "เงินสด",
  petty_cash: "เงินสดย่อย",
  payroll: "รวมกับเงินเดือน",
  worker_ledger: "เข้าบัญชีค่าแรงคนงาน",
};

/* ───────────── ตัวเลขเงิน ───────────── */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** ฿1,250 · ฿1,250.50 — มีสตางค์ค่อยแสดงทศนิยม 2 ตำแหน่งเสมอ (ไม่ขึ้น ฿1,250.5) */
export function baht(n: number, withSymbol = true): string {
  const v = round2(n);
  const frac = Math.abs(v % 1) > 0.0001;
  const s = Math.abs(v).toLocaleString("th-TH", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}${withSymbol ? "฿" : ""}${s}`;
}

/** ช่องกรอกเงิน → ตัวเลข (รับ "1,500", "฿ 1,500.50") · อ่านไม่ได้ = NaN */
export function parseMoney(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return raw;
  const s = String(raw ?? "").replace(/[฿,\s]/g, "");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

export interface ContractorBreakdown {
  /** ค่าบริการก่อน VAT */
  base: number;
  vatPercent: number;
  vat: number;
  /** รวม VAT = ที่ร้านเรียกเก็บ */
  gross: number;
  whtPercent: number;
  /** หัก ณ ที่จ่าย — คิดจากยอดก่อน VAT (กฎสรรพากร) */
  wht: number;
  /** จ่ายให้ร้านจริง */
  net: number;
}

export function contractorBreakdown(base: number, vatPercent: number, whtPercent: number): ContractorBreakdown {
  const b = round2(base);
  const vat = round2((b * vatPercent) / 100);
  const wht = round2((b * whtPercent) / 100);
  return { base: b, vatPercent, vat, gross: round2(b + vat), whtPercent, wht, net: round2(b + vat - wht) };
}

/* ───────────── OT ───────────── */

export interface OtRate {
  id: string;
  label: string;
  percent: number;
}

export const DEFAULT_OT_RATES: OtRate[] = [
  { id: "normal", label: "นอกเวลา วันทำงาน", percent: 150 },
  { id: "holiday", label: "ทำงานในวันหยุด", percent: 100 },
  { id: "holiday_ot", label: "นอกเวลา ในวันหยุด", percent: 300 },
];

/** "17:00","20:00" → 180 · ข้ามเที่ยงคืนได้ (22:00–02:00 = 240) */
export function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };
  let diff = toMin(end) - toMin(start);
  if (diff <= 0) diff += 1440;
  return diff;
}

export function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} นาที`;
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`;
}

export type OtBaseKind = "monthly" | "daily" | "manual";

export interface OtCalc {
  hourly: number;
  amount: number;
  /** ที่มาของตัวเลข อ่านได้ทันที เช่น "เงินเดือน ฿15,000 ÷ 30 ÷ 8 = ฿62.50/ชม. × 150% × 3 ชม." */
  formula: string;
}

/**
 * ค่า OT — พนักงานรายเดือน: เงินเดือน ÷ 30 ÷ 8 · คนงานรายวัน: ค่าแรง ÷ 8 (กติกาเดียวกับโมดูลคนงาน)
 * × % ที่เลือก × ชั่วโมง (ผู้ใช้กำหนด 21/10/2569)
 */
export function otCalc(baseKind: "monthly" | "daily", base: number, percent: number, minutes: number): OtCalc {
  const hourly = baseKind === "monthly" ? base / 30 / 8 : base / 8;
  const amount = round2(hourly * (percent / 100) * (minutes / 60));
  const head = baseKind === "monthly" ? `เงินเดือน ${baht(base)} ÷ 30 ÷ 8` : `ค่าแรง ${baht(base)}/วัน ÷ 8`;
  return { hourly: round2(hourly), amount, formula: `${head} = ${baht(round2(hourly))}/ชม. × ${percent}% × ${hoursText(minutes)}` };
}

/** ช่วงเวลาทับกันไหม (นาทีนับจากเที่ยงคืน ข้ามคืนได้) */
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const span = (s: string, e: string) => {
    const [h, m] = s.split(":").map(Number) as [number, number];
    const from = h * 60 + m;
    return [from, from + minutesBetween(s, e)] as const;
  };
  const [a1, a2] = span(aStart, aEnd);
  const [b1, b2] = span(bStart, bEnd);
  // ช่วงที่ข้ามเที่ยงคืนเลยไปถึงวันถัดไป — เทียบอีกฝั่งที่เลื่อนไป ±1 วันด้วย
  return [-1440, 0, 1440].some((shift) => a1 < b2 + shift && b1 + shift < a2);
}

/* ───────────── ไฟล์แนบ + ตรวจใบเสร็จ ───────────── */

export interface ReceiptAi {
  amount: number | null;
  date: string | null;
  vendor: string | null;
  receiptNo: string | null;
  isReceipt: boolean;
  /** ข้อสังเกตจาก AI เช่น "ตัวเลขดูถูกแก้" — ใช้เป็นข้อเตือนให้ HR ดู ไม่ใช่คำตัดสิน */
  notes: string | null;
}

export interface Attachment {
  url: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  role: AttachmentRole;
  by: string;
  at: string;
  ai?: ReceiptAi | null;
}

export interface ReceiptFlag {
  level: "block" | "warn";
  text: string;
}

/**
 * ข้อเตือนของใบเสร็จหนึ่งใบ — ระบบ "ช่วยดู" ไม่ได้ตัดสินแทน HR
 * block = ส่งไม่ได้ (ใบเสร็จวันที่ในอนาคต / ไฟล์เดียวกับที่เคยเบิกแล้ว)
 */
export function receiptFlags(
  att: Pick<Attachment, "ai">,
  ctx: { claimDate: string; today: string; maxAgeDays: number; duplicateOf?: string | null },
): ReceiptFlag[] {
  const out: ReceiptFlag[] = [];
  if (ctx.duplicateOf) out.push({ level: "block", text: `ไฟล์นี้เคยใช้เบิกแล้วใน ${ctx.duplicateOf}` });
  const ai = att.ai;
  if (!ai) return out;
  if (!ai.isReceipt) out.push({ level: "warn", text: "ระบบอ่านแล้วไม่เหมือนใบเสร็จ — ตรวจรูปอีกครั้ง" });
  if (ai.date) {
    if (ai.date > ctx.today) out.push({ level: "block", text: `วันที่บนใบเสร็จ (${thaiDate(ai.date)}) อยู่ในอนาคต` });
    else if (ai.date !== ctx.claimDate) out.push({ level: "warn", text: `วันที่บนใบเสร็จ ${thaiDate(ai.date)} ไม่ตรงกับวันที่กรอก ${thaiDate(ctx.claimDate)}` });
    const age = daysBetween(ai.date, ctx.today);
    if (age > ctx.maxAgeDays) out.push({ level: "warn", text: `ใบเสร็จเก่า ${age} วัน (เกิน ${ctx.maxAgeDays} วัน)` });
  }
  if (ai.notes) out.push({ level: "warn", text: ai.notes });
  return out;
}

/** ยอดรวมจากใบเสร็จที่อ่านได้ เทียบกับยอดที่ขอ — ต่างเกิน 1 บาท = เตือน */
export function amountMismatch(receipts: Pick<Attachment, "ai">[], claimed: number): string | null {
  const read = receipts.map((r) => r.ai?.amount).filter((x): x is number => typeof x === "number" && x > 0);
  if (read.length === 0 || read.length !== receipts.length) return null;
  const total = round2(read.reduce((s, x) => s + x, 0));
  if (Math.abs(total - claimed) <= 1) return null;
  return `ยอดในใบเสร็จรวม ${baht(total)} แต่ขอเบิก ${baht(claimed)}`;
}

/* ───────────── วันที่ ───────────── */

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "2026-10-21" → "21 ต.ค. 2569" */
export function thaiDate(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

/** ISO timestamp → "21 ต.ค. 2569 14:05" ตามเวลาไทย */
export function thaiDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const ymd = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const hm = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
  return `${thaiDate(ymd)} ${hm}`;
}

export function monthTitle(month: string): string {
  return `${TH_MONTHS[Number(month.slice(5, 7)) - 1]} ${Number(month.slice(0, 4)) + 543}`;
}

export function bangkokToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * วันที่จากช่อง <input type="date"> ที่คนพิมพ์ปี พ.ศ. ลงไป ("2569-10-21") — เบราว์เซอร์รับเป็น ค.ศ. 2569
 * ปีเกิน 2400 = พ.ศ. แปลงกลับเป็น ค.ศ. (เคยเจอใน HR: ขึ้น "27 ก.ย. 3112")
 */
export function normalizeDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return "";
  const year = Number(m[1]);
  const fixed = year >= 2400 ? `${year - 543}-${m[2]}-${m[3]}` : value.trim();
  return Number.isNaN(Date.parse(`${fixed}T00:00:00Z`)) ? "" : fixed;
}

/* ───────────── สถานะ ───────────── */

export interface StatusInfo {
  label: string;
  tone: "warn" | "info" | "ok" | "danger" | "muted";
  /** ขั้นต่อไปคืออะไร ใครต้องทำ */
  next: string;
}

export function statusInfo(r: {
  kind: RequestKind;
  status: RequestStatus;
  approverLevel: ApproverLevel;
  needCeo?: boolean;
  firstDecidedAt?: string | null;
  beneficiaryKind: BeneficiaryKind;
  paidTotal: number;
  netAmount: number;
  clearStatus: string | null;
  deductAmount: number;
  deductedAt: string | null;
}): StatusInfo {
  const approver = r.approverLevel === "ceo" ? "CEO" : "HR";
  switch (r.status) {
    case "pending":
      if (r.approverLevel === "ceo" && r.firstDecidedAt) return { label: "HR ผ่านแล้ว · รอ CEO", tone: "warn", next: "CEO อนุมัติ (ยอดเกินเกณฑ์)" };
      if (r.approverLevel === "hr" && r.needCeo) return { label: "รอ HR อนุมัติ", tone: "warn", next: "HR ตรวจ แล้วต่อ CEO (ยอดเกินเกณฑ์)" };
      return { label: `รอ ${approver} อนุมัติ`, tone: "warn", next: r.kind === "ot" ? `${approver} ตรวจว่ามีจริง` : `รอ ${approver} ตัดสิน` };
    case "rejected":
      return { label: "ไม่อนุมัติ", tone: "danger", next: "จบแล้ว" };
    case "cancelled":
      return { label: "ยกเลิก", tone: "muted", next: "จบแล้ว" };
    case "approved": {
      if (r.kind === "ot" && r.beneficiaryKind === "staff") return { label: "อนุมัติ · รอจ่าย", tone: "info", next: "HR จ่ายเลย หรือรวมกับเงินเดือน" };
      if (r.paidTotal > 0) return { label: `จ่ายแล้วบางส่วน`, tone: "info", next: `เหลือ ${baht(round2(r.netAmount - r.paidTotal))}` };
      return { label: "อนุมัติ · รอจ่าย", tone: "info", next: "HR บันทึกจ่าย + แนบสลิป" };
    }
    case "paid": {
      if (r.kind === "ot" && r.beneficiaryKind === "worker") return { label: "เข้าบัญชีค่าแรงแล้ว", tone: "ok", next: "จ่ายพร้อมค่าแรงที่หน้าจ่ายเงินคนงาน" };
      if (r.kind === "advance" && r.beneficiaryKind === "worker") return { label: "จ่ายแล้ว · หักจากค่าแรงอัตโนมัติ", tone: "ok", next: "ระบบคนงานหักจากค่าแรงวันถัดไปเอง" };
      if (r.kind === "cash_advance" && r.clearStatus !== "cleared") {
        return r.clearStatus === "submitted"
          ? { label: "ส่งใบเสร็จแล้ว · รอ HR ตรวจ", tone: "warn", next: "HR ตรวจใบเสร็จและเงินทอน" }
          : { label: "จ่ายแล้ว · รอส่งใบเสร็จ", tone: "warn", next: "คนเบิกส่งใบเสร็จ + คืนเงินทอน" };
      }
      if (r.deductAmount > 0 && !r.deductedAt) {
        return { label: r.beneficiaryKind === "worker" ? "จ่ายแล้ว · หักจากค่าแรงอัตโนมัติ" : "จ่ายแล้ว · รอหักเงินเดือน", tone: "info", next: r.beneficiaryKind === "worker" ? "ระบบคนงานหักเอง" : "HR หักในงวดเงินเดือน" };
      }
      return { label: "จ่ายแล้ว", tone: "ok", next: "จบแล้ว" };
    }
  }
}

export const TONE_CLASS: Record<StatusInfo["tone"], string> = {
  warn: "bg-amber-100 text-amber-900",
  info: "bg-violet-100 text-violet-900",
  ok: "bg-emerald-100 text-emerald-900",
  danger: "bg-red-100 text-red-900",
  muted: "bg-slate-200 text-slate-700",
};

export const KIND_CLASS: Record<RequestKind, string> = {
  ot: "bg-blue-100 text-blue-900",
  expense: "bg-slate-200 text-slate-800",
  cash_advance: "bg-teal-100 text-teal-900",
  advance: "bg-orange-100 text-orange-900",
  contractor: "bg-fuchsia-100 text-fuchsia-900",
};

/* ───────────── เพดานเบิกล่วงหน้า ───────────── */

export type AdvanceCapMode = "none" | "baht" | "days";

/** เพดานของคนนี้เดือนนี้ (บาท) — null = ไม่จำกัด · days ใช้ค่าแรงต่อวัน (พนักงาน = เงินเดือน ÷ 30) */
export function advanceCap(mode: AdvanceCapMode, value: number, dailyRate: number | null): number | null {
  if (mode === "none") return null;
  if (mode === "baht") return round2(value);
  if (dailyRate === null || dailyRate <= 0) return null;
  return round2(value * dailyRate);
}

/**
 * เส้นทางอนุมัติของประเภทหนึ่ง — ตั้งได้รายบริษัท (ผู้ใช้ 21/10/2569)
 *   mode hr  = HR อนุมัติ · ceoAbove = ยอดเกินเท่านี้ต้องให้ CEO อนุมัติต่ออีกขั้น (null = ไม่ต้อง · 0 = ทุกใบ)
 *   mode ceo = CEO อนุมัติคนเดียวทุกใบ (ไม่ผ่าน HR)
 * ใบที่ HR เป็นคนยื่นหรือเป็นผู้ได้เงินเอง ข้ามไป CEO เสมอ (อนุมัติใบของตัวเองไม่ได้)
 */
export interface ApprovalRoute {
  mode: "hr" | "ceo";
  ceoAbove: number | null;
}

export const DEFAULT_ROUTE: ApprovalRoute = { mode: "hr", ceoAbove: 5000 };

/** ใบนี้ต้องผ่านใคร: ขั้นแรก + ต้องต่อ CEO ไหม */
export function routeFor(route: ApprovalRoute | undefined, amount: number): { level: ApproverLevel; needCeo: boolean } {
  const r = route ?? DEFAULT_ROUTE;
  if (r.mode === "ceo") return { level: "ceo", needCeo: false };
  return { level: "hr", needCeo: r.ceoAbove !== null && amount > r.ceoAbove };
}

export function routeText(route: ApprovalRoute | undefined): string {
  const r = route ?? DEFAULT_ROUTE;
  if (r.mode === "ceo") return "CEO อนุมัติทุกใบ";
  if (r.ceoAbove === null) return "HR อนุมัติ";
  if (r.ceoAbove === 0) return "ทุกใบผ่าน HR แล้วต่อ CEO";
  return `HR อนุมัติ · ยอดเกิน ${baht(r.ceoAbove)} ต้องผ่าน CEO ด้วย`;
}

export interface RequestSettings {
  approvalRoutes: Record<RequestKind, ApprovalRoute>;
  otRates: OtRate[];
  advanceCapMode: AdvanceCapMode;
  advanceCapValue: number;
  whtRates: number[];
  vatPercent: number;
  receiptMaxAgeDays: number;
  clearDueDays: number;
}

export const DEFAULT_SETTINGS: RequestSettings = {
  approvalRoutes: { ot: DEFAULT_ROUTE, expense: DEFAULT_ROUTE, cash_advance: DEFAULT_ROUTE, advance: DEFAULT_ROUTE, contractor: DEFAULT_ROUTE },
  otRates: DEFAULT_OT_RATES,
  advanceCapMode: "baht",
  advanceCapValue: 3000,
  whtRates: [0, 1, 2, 3, 5],
  vatPercent: 7,
  receiptMaxAgeDays: 60,
  clearDueDays: 7,
};

export function daysInMonthOf(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonthOf(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/**
 * ค่าใช้จ่ายจริงของใบ — ปกติ = ยอดสุทธิ · เบิกเงินไปก่อนที่เคลียร์แล้ว = ยอดใช้จริงตามใบเสร็จ
 * (เบิกไป 500 ใช้จริง 450 ทอนคืน 50 → ค่าใช้จ่ายคือ 450 ไม่ใช่ 500) ใช้กับตัวเลขสรุป/รายงาน
 */
export function costOf(r: { kind: RequestKind; netAmount: number; clearSpent: number | null; clearStatus: string | null }): number {
  if (r.kind === "cash_advance" && r.clearStatus === "cleared" && r.clearSpent !== null) return r.clearSpent;
  return r.netAmount;
}

/** จำนวนตัวอักษรที่ต้องแก้ให้สองคำเท่ากัน (Levenshtein) — ใช้เทียบเลขอ้างอิงสลิปที่อ่านด้วย AI พลาดได้ 1–2 ตัว */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** เลขอ้างอิงสลิปสองใบ "น่าจะเป็นรายการเดียวกัน" — ยอด + วันที่ตรง และเลขต่างกันไม่เกิน 3 ตัว (AI อ่านพลาด/แคปจอใหม่) */
export function similarSlip(a: ReceiptAi | null | undefined, b: ReceiptAi | null | undefined): boolean {
  if (!a?.receiptNo || !b?.receiptNo || a.amount === null || b.amount === null) return false;
  if (Math.abs(a.amount - b.amount) > 0.005 || a.date !== b.date) return false;
  const x = a.receiptNo.replace(/\s+/g, "");
  const y = b.receiptNo.replace(/\s+/g, "");
  return x.length >= 8 && y.length >= 8 && editDistance(x, y) <= 3;
}

/** error จากการบันทึกจ่ายที่ขึ้นต้นแบบนี้ = สลิปคล้ายของใบอื่น หน้าเว็บถามยืนยันก่อนส่งซ้ำ ("SIMILAR|<เลขที่ใบ>|<ข้อความ>") */
export const SIMILAR_SLIP_PREFIX = "SIMILAR|";
