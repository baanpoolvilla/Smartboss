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
