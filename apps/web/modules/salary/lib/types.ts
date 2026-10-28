/**
 * โมดูลเงินเดือน — ชนิดข้อมูล ค่าตั้งต้น และเครื่องมือเงิน/วันที่ (ไม่มี I/O — ใช้ได้ทั้ง server/client/test)
 *
 * เงินทุกจำนวนในการคำนวณเก็บเป็น "สตางค์" (จำนวนเต็ม) แล้วค่อยแปลงเป็นบาทตอนแสดง/บันทึก —
 * ทศนิยมของ JavaScript บวกกันหลายบรรทัดแล้วเพี้ยนได้ (0.1 + 0.2) ยอดในตาราง สลิป และไฟล์โอนต้องตรงกันทุกสตางค์
 */

export type ApprovalMode = "ceo" | "ceo_on_change" | "hr";
export type LateMode = "minute" | "per_time";
export type PayChannel = "transfer" | "cash";
export type TaxMode = "auto" | "fixed" | "none";
export type RunStatus = "draft" | "submitted" | "approved" | "paid";
export type ItemKind = "earning" | "deduction";
export type OtMode = "hours" | "days";
/** เบี้ยขยันของคนที่เข้างาน/ลาออกกลางรอบ */
export type DiligencePartial = "none" | "prorate" | "full";

/* ───────────── เงิน (สตางค์) ───────────── */

/** บาท → สตางค์ (ปัดครึ่งขึ้น) — ใช้ตอนรับค่าจากภายนอก (ฐานข้อมูล/ฟอร์ม) เท่านั้น */
export function toSatang(baht: number): number {
  if (!Number.isFinite(baht)) return 0;
  // +EPSILON กัน 1.005 * 100 = 100.49999 แล้วปัดลง
  return Math.round(baht * 100 + (baht >= 0 ? 1e-7 : -1e-7));
}
export const toBaht = (satang: number): number => satang / 100;

/** ปัดเป็นบาทเต็มแบบประกันสังคม: เศษตั้งแต่ 50 สตางค์ปัดขึ้น ต่ำกว่าปัดทิ้ง */
export const roundSatangToBaht = (satang: number): number => Math.floor((satang + 50) / 100) * 100;

/** 1234567 สตางค์ → "12,345.67" */
export function fmt(satang: number): string {
  const neg = satang < 0;
  const abs = Math.abs(Math.round(satang));
  const baht = Math.floor(abs / 100).toLocaleString("en-US");
  return `${neg ? "-" : ""}${baht}.${String(abs % 100).padStart(2, "0")}`;
}
export const fmtBaht = (baht: number): string => fmt(toSatang(baht));

/* ───────────── อัตราตามกฎหมาย (ตั้งได้ มีวันเริ่มมีผล) ───────────── */

export interface SsoParams {
  /** % ลูกจ้าง */
  employeeRate: number;
  /** % นายจ้าง */
  employerRate: number;
  /** ค่าจ้างต่ำสุดที่ใช้คิด (บาท) */
  wageFloor: number;
  /** เพดานค่าจ้าง (บาท) */
  wageCeiling: number;
  /** เงินสมทบสูงสุดต่อเดือนต่อฝ่าย (บาท) */
  maxContribution: number;
}

export interface TaxBracket {
  /** เงินได้สุทธิถึง (บาท) — null = ส่วนที่เกินขั้นก่อนหน้าทั้งหมด */
  upTo: number | null;
  /** อัตรา % */
  rate: number;
}

export interface TaxParams {
  /** หักค่าใช้จ่าย % ของเงินได้ (มาตรา 40(1)) */
  expenseRate: number;
  /** หักค่าใช้จ่ายไม่เกิน (บาท) */
  expenseCap: number;
  /** ลดหย่อนส่วนตัว (บาท) */
  personalAllowance: number;
  brackets: TaxBracket[];
}

/** ประกันสังคม ม.33 ปี 2569–2571: เพดาน 17,500 สมทบสูงสุด 875 (ข่าวกระทรวงแรงงาน · บริษัทแก้ได้ในตั้งค่า) */
export const DEFAULT_SSO: SsoParams = { employeeRate: 5, employerRate: 5, wageFloor: 1650, wageCeiling: 17500, maxContribution: 875 };

/** ภาษีเงินได้บุคคลธรรมดา — ค่าใช้จ่าย 50% ไม่เกิน 100,000 · ลดหย่อนส่วนตัว 60,000 · ขั้นบันไดปัจจุบัน */
export const DEFAULT_TAX: TaxParams = {
  expenseRate: 50,
  expenseCap: 100000,
  personalAllowance: 60000,
  brackets: [
    { upTo: 150000, rate: 0 },
    { upTo: 300000, rate: 5 },
    { upTo: 500000, rate: 10 },
    { upTo: 750000, rate: 15 },
    { upTo: 1000000, rate: 20 },
    { upTo: 2000000, rate: 25 },
    { upTo: 5000000, rate: 30 },
    { upTo: null, rate: 35 },
  ],
};

export interface RateRow<P> {
  effectiveFrom: string;
  params: P;
}

/** อัตราที่มีผล ณ วันนั้น (แถวล่าสุดที่เริ่มก่อน/ตรงวัน) — ไม่มีเลย = ค่าตั้งต้น */
export function rateOn<P>(rows: RateRow<P>[], date: string, fallback: P): P {
  let best: RateRow<P> | null = null;
  for (const r of rows) {
    if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best ? best.params : fallback;
}

/** ตรวจค่าที่กรอกในตั้งค่า — คืนข้อความผิดข้อแรก หรือ null */
export function validateSso(p: SsoParams): string | null {
  const ok = (n: number) => Number.isFinite(n) && n >= 0;
  if (![p.employeeRate, p.employerRate, p.wageFloor, p.wageCeiling, p.maxContribution].every(ok)) return "ตัวเลขประกันสังคมต้องเป็นตัวเลขไม่ติดลบ";
  if (p.employeeRate > 20 || p.employerRate > 20) return "% ประกันสังคมสูงผิดปกติ (เกิน 20%)";
  if (p.wageFloor > p.wageCeiling) return "ค่าจ้างต่ำสุดต้องไม่เกินเพดาน";
  return null;
}

export function validateTax(p: TaxParams): string | null {
  const ok = (n: number) => Number.isFinite(n) && n >= 0;
  if (![p.expenseRate, p.expenseCap, p.personalAllowance].every(ok)) return "ตัวเลขภาษีต้องเป็นตัวเลขไม่ติดลบ";
  if (p.expenseRate > 100) return "% หักค่าใช้จ่ายเกิน 100";
  if (p.brackets.length === 0) return "ต้องมีขั้นบันไดภาษีอย่างน้อย 1 ขั้น";
  let prev = 0;
  for (let i = 0; i < p.brackets.length; i++) {
    const b = p.brackets[i]!;
    if (!ok(b.rate) || b.rate > 100) return `อัตราขั้นที่ ${i + 1} ไม่ถูกต้อง`;
    if (b.upTo === null) {
      if (i !== p.brackets.length - 1) return "ขั้น \"เกินจากนั้น\" ต้องอยู่ท้ายสุด";
    } else {
      if (!ok(b.upTo) || b.upTo <= prev) return `ขั้นที่ ${i + 1}: ยอด "ถึง" ต้องมากกว่าขั้นก่อนหน้า`;
      prev = b.upTo;
    }
  }
  if (p.brackets[p.brackets.length - 1]!.upTo !== null) return "ขั้นสุดท้ายต้องเป็น \"เกินจากนั้น\"";
  return null;
}

/* ───────────── งวด ───────────── */

const pad = (n: number) => String(n).padStart(2, "0");
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** จำนวนวันจาก a ถึง b รวมทั้งสองวัน */
export function daysBetweenInclusive(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * งวด YYYY-MM (เดือนของวันตัดงวด): วันตัด = cutoffDay ของเดือนนั้น (เกินจำนวนวันของเดือน = สิ้นเดือน)
 * เริ่ม = วันถัดจากวันตัดของเดือนก่อน · วันจ่าย payDay 0 = สิ้นเดือนของงวด
 */
export function periodDates(period: string, cutoffDay: number, payDay: number): { startsOn: string; endsOn: string; payDate: string } {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const endDay = Math.min(cutoffDay, daysInMonth(y, m));
  const endsOn = `${y}-${pad(m)}-${pad(endDay)}`;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const prevEnd = `${py}-${pad(pm)}-${pad(Math.min(cutoffDay, daysInMonth(py, pm)))}`;
  const startsOn = addDays(prevEnd, 1);
  const pd = payDay === 0 ? daysInMonth(y, m) : Math.min(payDay, daysInMonth(y, m));
  return { startsOn, endsOn, payDate: `${y}-${pad(m)}-${pad(pd)}` };
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** "2026-10" → "ต.ค. 2569" */
export function periodLabel(period: string, full = false): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return `${(full ? TH_MONTH_FULL : TH_MONTH)[m - 1]} ${y + 543}`;
}

/** "2026-10-31" → "31 ต.ค. 2569" */
export function thaiDate(date: string, withYear = true): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${TH_MONTH[m - 1]}${withYear ? ` ${y + 543}` : ""}`;
}

export function bangkokToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

/* ───────────── ข้อมูลตั้งค่า ───────────── */

export interface SettingsView {
  cutoffDay: number;
  payDay: number;
  approvalMode: ApprovalMode;
  changeThreshold: number;
  deductLate: boolean;
  lateMode: LateMode;
  latePerTime: number;
  deductAbsent: boolean;
  deductUnpaidLeave: boolean;
  otSsoBase: boolean;
  /** false = ไม่คิด/ไม่หักภาษีหัก ณ ที่จ่าย (ไม่มีบรรทัดภาษี) */
  taxEnabled: boolean;
  /** hours = ตามใบ OT รายชั่วโมง · days = ปัดขึ้น(เงินเดือน ÷ 30) × จำนวนวันที่มี OT */
  otMode: OtMode;
  /** เบี้ยขยันขั้นบันได */
  diligenceEnabled: boolean;
  /** ขั้นเบี้ยขยัน (บาท) เรียงน้อยไปมาก */
  diligenceSteps: number[];
  /** เข้างาน/ลาออกกลางรอบ: none = ไม่ได้ (ต้องครบรอบ) · prorate = เฉลี่ยตามวัน · full = ได้เต็มขั้น */
  diligencePartial: DiligencePartial;
  editorUserIds: string[];
  superAdminAccess: boolean;
  companyTaxId: string;
  ssoEmployerNo: string;
  ssoBranch: string;
  payBankName: string;
  payBankAccount: string;
  updatedByName: string;
}

export const DEFAULT_SETTINGS: SettingsView = {
  cutoffDay: 25,
  payDay: 0,
  approvalMode: "ceo",
  changeThreshold: 5,
  deductLate: false,
  lateMode: "minute",
  latePerTime: 0,
  deductAbsent: false,
  deductUnpaidLeave: true,
  otSsoBase: true,
  taxEnabled: true,
  otMode: "hours",
  diligenceEnabled: false,
  diligenceSteps: [500, 800, 1000],
  diligencePartial: "none",
  editorUserIds: [],
  superAdminAccess: true,
  companyTaxId: "",
  ssoEmployerNo: "",
  ssoBranch: "000000",
  payBankName: "",
  payBankAccount: "",
  updatedByName: "",
};

/**
 * ค่าลดหย่อนตาม ล.ย.01 ที่มีช่องให้กรอก (ต่อปี) — "อื่นๆ" พิมพ์ชื่อเอง
 * flag/count = ติ๊ก/ใส่จำนวนคน ระบบคูณเงินให้ (กันพิมพ์ "2" ในช่องบุตรแล้วได้ลดหย่อน 2 บาท)
 * cap = เพดานตามกฎหมาย ใส่เกินระบบใช้เพดานแทนและบอกให้รู้
 */
export interface AllowanceField {
  key: string;
  label: string;
  hint?: string;
  kind: "flag" | "count" | "amount";
  per?: number;
  maxCount?: number;
  cap?: number;
}
export const ALLOWANCE_FIELDS: AllowanceField[] = [
  { key: "spouse", label: "คู่สมรสไม่มีเงินได้", hint: "60,000", kind: "flag", per: 60_000 },
  { key: "children", label: "บุตร (จำนวนคน)", hint: "คนละ 30,000", kind: "count", per: 30_000, maxCount: 20 },
  { key: "children_2018", label: "ในนั้น บุตรคนที่ 2 ขึ้นไปที่เกิดตั้งแต่ปี 2561 (คน)", hint: "ได้เพิ่มอีกคนละ 30,000 (รวมคนละ 60,000)", kind: "count", per: 30_000, maxCount: 19 },
  { key: "parents", label: "อุปการะบิดามารดา (จำนวนคน)", hint: "คนละ 30,000 · ไม่เกิน 4 คน (พ่อแม่ตัวเองและคู่สมรส)", kind: "count", per: 30_000, maxCount: 4 },
  { key: "disabled", label: "อุปการะคนพิการ (จำนวนคน)", hint: "คนละ 60,000", kind: "count", per: 60_000, maxCount: 10 },
  { key: "life_insurance", label: "เบี้ยประกันชีวิต", hint: "ไม่เกิน 100,000", kind: "amount", cap: 100_000 },
  { key: "health_insurance", label: "เบี้ยประกันสุขภาพ", hint: "ไม่เกิน 25,000 · รวมกับประกันชีวิตไม่เกิน 100,000", kind: "amount", cap: 25_000 },
  { key: "parent_health", label: "ประกันสุขภาพบิดามารดา", hint: "ไม่เกิน 15,000", kind: "amount", cap: 15_000 },
  { key: "provident_fund", label: "กองทุนสำรองเลี้ยงชีพ", hint: "ไม่เกิน 15% ของค่าจ้าง และไม่เกิน 500,000", kind: "amount", cap: 500_000 },
  { key: "home_loan", label: "ดอกเบี้ยเงินกู้ซื้อบ้าน", hint: "ไม่เกิน 100,000", kind: "amount", cap: 100_000 },
  { key: "ssf_rmf", label: "SSF / RMF / Thai ESG", hint: "ตามหนังสือรับรองของกองทุน", kind: "amount", cap: 500_000 },
  { key: "donation", label: "เงินบริจาค", hint: "ไม่เกิน 10% ของเงินได้หลังหักลดหย่อน", kind: "amount" },
];

export interface AllowanceEntry {
  key: string;
  label: string;
  amount: number;
  /** จำนวนคน (เฉพาะช่องแบบนับคน) */
  count?: number;
}

/**
 * คิดยอดลดหย่อนจากที่กรอก — ใช้ทั้งหน้าจอ (โชว์ทันที) และฝั่ง server (ตัวจริงที่บันทึก)
 * ช่องนับคน: ยอด = จำนวน × อัตรา (ข้อมูลเก่าที่มีแต่ยอด แปลงกลับเป็นจำนวนคน) · ช่องเงิน: ตัดที่เพดาน
 * คืน notes = สิ่งที่ระบบปรับให้ เพื่อบอกคนกรอก
 */
export function normalizeAllowances(list: AllowanceEntry[]): { list: AllowanceEntry[]; notes: string[] } {
  const notes: string[] = [];
  const out: AllowanceEntry[] = [];
  const byKey = new Map(ALLOWANCE_FIELDS.map((f) => [f.key, f]));
  for (const a of list) {
    const f = byKey.get(a.key);
    if (!f) {
      out.push({ key: a.key, label: a.label, amount: Math.max(0, toBaht(toSatang(Number(a.amount) || 0))) });
      continue;
    }
    if (f.kind === "flag") {
      const on = (a.count ?? (Number(a.amount) > 0 ? 1 : 0)) > 0;
      if (on) out.push({ key: f.key, label: f.label, amount: f.per!, count: 1 });
      continue;
    }
    if (f.kind === "count") {
      let n = Math.floor(a.count ?? Math.round((Number(a.amount) || 0) / f.per!));
      if (n > f.maxCount!) {
        notes.push(`${f.label}: ใส่ได้ไม่เกิน ${f.maxCount} คน`);
        n = f.maxCount!;
      }
      if (n > 0) out.push({ key: f.key, label: f.label, amount: n * f.per!, count: n });
      continue;
    }
    let amt = Math.max(0, toBaht(toSatang(Number(a.amount) || 0)));
    if (f.cap !== undefined && amt > f.cap) {
      notes.push(`${f.label}: ใช้ได้ไม่เกิน ${fmtBaht(f.cap)} — ระบบใช้ ${fmtBaht(f.cap)}`);
      amt = f.cap;
    }
    if (amt > 0) out.push({ key: f.key, label: f.label, amount: amt });
  }
  // บุตรเกิดตั้งแต่ 2561 คนที่ 2 ขึ้นไป ต้องไม่เกินจำนวนบุตรทั้งหมด − 1
  const kids = out.find((a) => a.key === "children")?.count ?? 0;
  const k18 = out.find((a) => a.key === "children_2018");
  if (k18 && k18.count! > Math.max(0, kids - 1)) {
    const n = Math.max(0, kids - 1);
    notes.push(`บุตรคนที่ 2 ขึ้นไปที่เกิดตั้งแต่ 2561 ต้องน้อยกว่าจำนวนบุตรทั้งหมด — ระบบใช้ ${n} คน`);
    if (n === 0) out.splice(out.indexOf(k18), 1);
    else Object.assign(k18, { count: n, amount: n * 30_000 });
  }
  // ประกันชีวิต + ประกันสุขภาพ รวมไม่เกิน 100,000
  const life = out.find((a) => a.key === "life_insurance");
  const health = out.find((a) => a.key === "health_insurance");
  if (life && health && life.amount + health.amount > 100_000) {
    health.amount = Math.max(0, 100_000 - life.amount);
    notes.push(`ประกันชีวิต + ประกันสุขภาพ รวมไม่เกิน 100,000 — ระบบใช้ประกันสุขภาพ ${fmtBaht(health.amount)}`);
    if (health.amount === 0) out.splice(out.indexOf(health), 1);
  }
  return { list: out, notes };
}

export function allowanceTotal(list: AllowanceEntry[]): number {
  return toBaht(list.reduce((s, a) => s + Math.max(0, toSatang(a.amount)), 0));
}

/** ขั้นเบี้ยขยันจากตั้งค่า — ตัวเลขบวก ไม่ซ้ำ เรียงน้อยไปมาก 1–6 ขั้น · ผิด = null */
export function normalizeDiligenceSteps(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.map((x) => Number(x));
  if (list.length < 1 || list.length > 6) return null;
  if (!list.every((n) => Number.isFinite(n) && n > 0 && n <= 1_000_000 && Math.round(n * 100) === n * 100)) return null;
  for (let i = 1; i < list.length; i++) if (list[i]! <= list[i - 1]!) return null;
  return list;
}
