/**
 * ค่าคอม Pool — แบ่งยอดรวมของบริษัทให้พนักงานตามตัวคูณของเกรดผลงาน (ล้วน ไม่แตะฐานข้อมูล)
 *
 *   หน่วยของคน   = ตัวคูณของเกรดที่คนนั้นได้ในเดือนนั้น
 *   เงินต่อหน่วย = Pool ÷ หน่วยรวมของทุกคน
 *   ค่าคอมของคน  = เงินต่อหน่วย × หน่วยของคน
 *
 * คิดเป็นสตางค์ (จำนวนเต็ม) ทั้งหมด แล้วแจกเศษสตางค์ที่เหลือจากการปัดลงให้คนที่
 * เศษมากสุดก่อน — ยอดรวมของทุกคนจึงเท่ากับ Pool พอดีทุกครั้ง ไม่ขาดไม่เกินแม้แต่สตางค์เดียว
 */

/** ชื่อเกรดที่ได้เมื่อคะแนนต่ำกว่าทุกเกณฑ์ — ตรงกับ gradeOf() ใน lib/performance.ts */
export const BELOW_ALL_GRADES = "F";

/** ตัวคูณสูงสุดที่รับ — กันพิมพ์ผิดจนคนเดียวกินทั้ง Pool */
export const MAX_GRADE_WEIGHT = 100;

/** Pool สูงสุดที่รับ (บาท) — ให้คิดเป็นสตางค์ด้วย number ได้โดยไม่ล้นความแม่นยำ */
export const MAX_POOL_BAHT = 99_999_999.99;

export interface CommissionMember {
  userId: string;
  name: string;
  email: string;
  grade: string;
  score: number;
}

export interface CommissionShare extends CommissionMember {
  weight: number;
  /** ค่าคอมเป็นสตางค์ */
  amountSatang: number;
}

export interface CommissionSplit {
  shares: CommissionShare[];
  /** หน่วยรวมของทุกคน (ผลรวมตัวคูณ) */
  totalUnits: number;
  /** เงินต่อหน่วยเป็นสตางค์ (อาจมีทศนิยม) — null เมื่อไม่มีใครมีหน่วยเลย */
  perUnitSatang: number | null;
  /** ยอดที่แจกไม่ออก — เกิดเมื่อทุกคนได้ตัวคูณ 0 */
  undistributedSatang: number;
}

/** ลำดับเกรดทั้งหมดที่เป็นไปได้ เรียงจากดีสุด — ต่อท้ายด้วย F ถ้าเกณฑ์ไม่ได้ตั้งชื่อ F ไว้เอง */
export function commissionGradeOrder(thresholdGrades: readonly string[]): string[] {
  return thresholdGrades.includes(BELOW_ALL_GRADES)
    ? [...thresholdGrades]
    : [...thresholdGrades, BELOW_ALL_GRADES];
}

/**
 * ตัวคูณตั้งต้นเมื่อบริษัทยังไม่ได้ตั้ง — ไล่ลงเท่า ๆ กันตามอันดับเกรด
 * A-D → 1 · 0.75 · 0.5 · 0.25 และต่ำกว่าทุกเกณฑ์ได้ 0
 */
export function defaultGradeWeights(thresholdGrades: readonly string[]): Record<string, number> {
  const ranked = thresholdGrades.filter((g) => g !== BELOW_ALL_GRADES);
  const n = ranked.length;
  const out: Record<string, number> = {};
  ranked.forEach((grade, i) => {
    out[grade] = Math.round(((n - i) / n) * 100) / 100;
  });
  out[BELOW_ALL_GRADES] = 0;
  return out;
}

/** ตัวคูณที่ใช้จริง — ค่าที่บริษัทตั้งไว้ทับค่าตั้งต้นเฉพาะเกรดที่ตั้ง */
export function resolveGradeWeights(
  thresholdGrades: readonly string[],
  saved: Record<string, unknown>,
): Record<string, number> {
  const defaults = defaultGradeWeights(thresholdGrades);
  const out: Record<string, number> = {};
  for (const grade of commissionGradeOrder(thresholdGrades)) {
    const value = saved[grade];
    out[grade] =
      typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_GRADE_WEIGHT
        ? value
        : (defaults[grade] ?? 0);
  }
  return out;
}

/** "12,345.67" / 12345.67 → 1234567 สตางค์ · รูปแบบผิดหรือเกินขอบเขต = null */
export function parseBahtToSatang(input: string | number): number | null {
  const raw = typeof input === "number" ? String(input) : input.replace(/[,\s฿]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value > MAX_POOL_BAHT) return null;
  return Math.round(value * 100);
}

/** ตัวคูณจากช่องกรอก — ทศนิยมไม่เกิน 2 ตำแหน่ง ช่วง 0..MAX_GRADE_WEIGHT · ผิด = null */
export function parseGradeWeight(input: string): number | null {
  const raw = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_GRADE_WEIGHT ? value : null;
}

export function splitCommissionPool(
  poolSatang: number,
  members: readonly CommissionMember[],
  weights: Record<string, number>,
): CommissionSplit {
  // ตัวคูณทศนิยม 2 ตำแหน่ง → จำนวนเต็ม (×100) กันเลขทศนิยมลอยตัวเพี้ยน
  const units = members.map((m) => Math.round((weights[m.grade] ?? 0) * 100));
  const totalHundredths = units.reduce((sum, u) => sum + u, 0);

  if (poolSatang <= 0 || totalHundredths === 0) {
    return {
      shares: members.map((m, i) => ({ ...m, weight: units[i]! / 100, amountSatang: 0 })),
      totalUnits: totalHundredths / 100,
      perUnitSatang: totalHundredths === 0 ? null : 0,
      undistributedSatang: totalHundredths === 0 ? Math.max(poolSatang, 0) : 0,
    };
  }

  const floors = units.map((u) => Math.floor((poolSatang * u) / totalHundredths));
  const remainders = units.map((u) => (poolSatang * u) % totalHundredths);
  let leftover = poolSatang - floors.reduce((sum, f) => sum + f, 0);

  // เศษมากสุดได้ก่อน · เศษเท่ากันเรียงตาม userId ให้ผลเหมือนเดิมทุกครั้งที่เปิดหน้า
  const order = members
    .map((m, i) => i)
    .filter((i) => units[i]! > 0)
    .sort((a, b) => remainders[b]! - remainders[a]! || members[a]!.userId.localeCompare(members[b]!.userId));
  for (const i of order) {
    if (leftover <= 0) break;
    floors[i]! += 1;
    leftover -= 1;
  }

  return {
    shares: members.map((m, i) => ({ ...m, weight: units[i]! / 100, amountSatang: floors[i]! })),
    totalUnits: totalHundredths / 100,
    perUnitSatang: (poolSatang * 100) / totalHundredths,
    undistributedSatang: 0,
  };
}

/** 1234567 → "12,345.67" */
export function formatSatang(satang: number): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(satang / 100);
}

/* ═════════════════ วิธีคิดแบบอื่น (เลือกได้ต่อบริษัท) ═════════════════ */

/**
 * pool    = ใส่ยอดรวมทุกเดือน แบ่งตามตัวคูณเกรด (แบบเดิม)
 * percent = เกรดไหนได้กี่ % ของเงินเดือนคนนั้น (ยอดเงินคิดในงวดเงินเดือน — ที่นี่ไม่รู้เงินเดือน)
 * fixed   = เกรดไหนได้กี่บาท เท่ากันทุกคน
 * off     = ไม่คิดค่าคอมจากเกรด (บริษัทที่ไม่ผูกเกรดกับเงิน — ใส่ค่าคอมเองรายคนในงวดเงินเดือนได้)
 */
export type CommissionMethod = "pool" | "percent" | "fixed" | "off";
export const COMMISSION_METHODS: { id: CommissionMethod; label: string; hint: string }[] = [
  { id: "pool", label: "แบ่งจากยอดรวม (Pool) ตามตัวคูณเกรด", hint: "ใส่ยอดรวมทุกเดือน ระบบแบ่งให้ตามเกรด เช่น A ได้ 1 ส่วน B ได้ 0.75 ส่วน" },
  { id: "percent", label: "% ของเงินเดือน ตามเกรด", hint: "เช่น A ได้ 10% B ได้ 5% ของเงินเดือนคนนั้น — ไม่ต้องใส่ยอดทุกเดือน" },
  { id: "fixed", label: "จำนวนเงินตายตัว ตามเกรด", hint: "เช่น A ได้ 3,000 B ได้ 1,500 บาท เท่ากันทุกคนในเกรดเดียวกัน" },
  { id: "off", label: "ไม่คิดค่าคอมจากเกรด", hint: "เกรดไม่เกี่ยวกับเงิน — ถ้ามีค่าคอม ใส่เองรายคนในงวดเงินเดือน" },
];
export function toCommissionMethod(v: unknown): CommissionMethod {
  return v === "percent" || v === "fixed" || v === "off" ? v : "pool";
}

/** % ไม่เกิน 100 · บาทไม่เกินขีดของ Pool */
export const MAX_GRADE_PERCENT = 100;

/** ค่าต่อเกรดของวิธี percent/fixed — ไม่ได้ตั้ง = 0 (ไม่ได้ค่าคอม) */
export function resolveGradeValues(order: readonly string[], saved: Record<string, unknown>, method: CommissionMethod): Record<string, number> {
  const max = method === "percent" ? MAX_GRADE_PERCENT : MAX_POOL_BAHT;
  const out: Record<string, number> = {};
  for (const grade of order) {
    const v = saved[grade];
    out[grade] = typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : 0;
  }
  return out;
}

/** ช่องกรอกค่าต่อเกรด — ทศนิยมไม่เกิน 2 ตำแหน่ง · ผิด/เกินขีด = null */
export function parseGradeValue(input: string, method: CommissionMethod): number | null {
  const raw = input.replace(/[,\s฿%]/g, "");
  if (raw === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return value <= (method === "percent" ? MAX_GRADE_PERCENT : MAX_POOL_BAHT) ? value : null;
}

export interface CommissionEligibility {
  /** ว่าง = ทุกแผนก */
  departmentIds: string[];
  excludedUserIds: string[];
}

/** ได้ค่าคอมไหม: อยู่ในแผนกที่เลือก (ไม่ได้เลือก = ทุกแผนก) และไม่ถูกยกเว้นรายคน */
export function isCommissionEligible(m: { userId: string; departmentId?: string | null }, e: CommissionEligibility): boolean {
  if (e.excludedUserIds.includes(m.userId)) return false;
  if (e.departmentIds.length === 0) return true;
  return !!m.departmentId && e.departmentIds.includes(m.departmentId);
}

/**
 * ค่าคอมของคนหนึ่งตามวิธีที่บริษัทเลือก (หลังกรองคนที่ได้แล้ว)
 * percent คืน % ไว้ให้งวดเงินเดือนคูณเงินเดือนเอง · pool ใช้ส่วนแบ่งจาก splitCommissionPool
 */
export type CommissionFor =
  | { kind: "amount"; satang: number; detail: string }
  | { kind: "percent"; percent: number; detail: string }
  | null;
