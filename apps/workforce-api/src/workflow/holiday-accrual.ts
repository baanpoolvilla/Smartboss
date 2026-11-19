/**
 * สิทธิ์ Holiday แบบสะสม — คิดเป็น "ถัง" รายเดือน
 *
 * แต่ละเดือนได้สิทธิ์เท่าจำนวนวันหยุดบริษัทของเดือนนั้น (หรือจำนวนที่ HR กำหนดทับ)
 * สิทธิ์ของเดือน M ใช้ได้ภายใน N เดือนนับรวมเดือน M เอง (N = 3: ก.ค. → ใช้ได้ถึงสิ้น ก.ย.) เกินนั้นตัดทิ้ง
 * N ตั้งได้ต่อประเภทลา (leave_types.holiday_valid_months · ผู้ใช้ 19/11/2569) ค่าเดิม 3
 * ตัดตามรอบปี (leave_types.holiday_year_carry_months · ผู้ใช้ 19/11/2569 "ของ ธ.ค. 69 ให้สิ้นสุดแค่ ม.ค. 70 ไม่ข้ามปีเกินไป"):
 *   สิทธิ์ของปี Y ใช้ได้ไม่เกินสิ้นเดือนที่ C ของปี Y+1 (C = 0 → สิ้น ธ.ค. ปี Y เอง · 1 → สิ้น ม.ค. ปีถัดไป) · null = ไม่ตัด
 *   หมดอายุ = อันไหนถึงก่อน ระหว่าง "ครบ N เดือน" กับ "ถึงเส้นตัดของปี"
 * การใช้ตัดจากถังที่เก่าที่สุดก่อน (ของที่ใกล้หมดอายุถูกใช้ก่อน ไม่เสียสิทธิ์โดยไม่จำเป็น)
 *
 * ไม่เก็บยอดคงเหลือเป็นตัวเลข — คำนวณใหม่จากสิทธิ์รายเดือนกับใบที่ลงไว้ทุกครั้ง
 * HR แก้จำนวนวันของเดือนย้อนหลัง หรือมีคนยกเลิกวันหยุด ยอดก็ถูกเองโดยไม่ต้องปรับบัญชี
 */
export const HOLIDAY_VALID_MONTHS = 3;

/** ค่าที่บริษัทตั้งไว้ต่อประเภท (leave_types.holiday_valid_months 1–12) — ไม่มี/เพี้ยน = 3 เหมือนเดิม */
export function validMonthsOf(value: number | null | undefined): number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12 ? (value as number) : HOLIDAY_VALID_MONTHS;
}

/** ค่าตัดตามรอบปี (0–11) — ไม่มี/เพี้ยน = null (ไม่ตัด เหมือนก่อนมีตั้งค่า) */
export function yearCarryOf(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 11 ? (value as number) : null;
}

/** เดือนสุดท้าย (เลขเดือนต่อเนื่อง) ที่สิทธิ์ของเดือน `month` ยังใช้ได้ */
export function expiryIndex(month: number, validMonths: number, yearCarry: number | null): number {
  const byMonths = month + validMonths - 1;
  if (yearCarry === null) return byMonths;
  const byYear = Math.floor(month / 12) * 12 + 11 + yearCarry;
  return Math.min(byMonths, byYear);
}

/** 'YYYY-MM' → เลขเดือนต่อเนื่อง (ใช้บวกลบข้ามปี) */
export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
}

export function monthOfIndex(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export interface HolidayBucket {
  /** เดือนที่ได้สิทธิ์ */
  month: string;
  remaining_days: number;
  /** เดือนสุดท้ายที่ยังใช้ได้ */
  expires_month: string;
}

interface Simulation {
  /** วันที่ใช้เกินสิทธิ์รวมทุกเดือน — ไม่ทบเป็นหนี้ไปเดือนถัดไป */
  deficit: number;
  /** ถังที่เหลือหลังหักการใช้ของเดือนนั้นแล้ว */
  bucketsAt: Map<number, HolidayBucket[]>;
}

function simulate(
  from: number,
  to: number,
  grantOf: (month: number) => number,
  usageOf: (month: number) => number,
  validMonths: number,
  yearCarry: number | null,
): Simulation {
  let buckets: { month: number; left: number }[] = [];
  let deficit = 0;
  const bucketsAt = new Map<number, HolidayBucket[]>();
  for (let month = from; month <= to; month += 1) {
    buckets = buckets.filter((bucket) => month <= expiryIndex(bucket.month, validMonths, yearCarry));
    const granted = grantOf(month);
    if (granted > 0) buckets.push({ month, left: granted });
    let need = usageOf(month);
    for (const bucket of buckets) {
      const take = Math.min(bucket.left, need);
      bucket.left -= take;
      need -= take;
    }
    deficit += need;
    bucketsAt.set(
      month,
      buckets
        .filter((bucket) => bucket.left > 0)
        .map((bucket) => ({
          month: monthOfIndex(bucket.month),
          remaining_days: bucket.left,
          expires_month: monthOfIndex(expiryIndex(bucket.month, validMonths, yearCarry)),
        })),
    );
  }
  return { deficit, bucketsAt };
}

/** สิทธิ์ของแต่ละเดือนที่ยังอยู่ในช่วงใช้ได้ ณ เดือนที่ถาม — รวมเดือนที่ใช้หมดแล้วด้วย (หน้ารายละเอียด Holiday) */
export interface HolidayGrant {
  /** เดือนที่ได้สิทธิ์ */
  month: string;
  granted_days: number;
  remaining_days: number;
  /** เดือนสุดท้ายที่ยังใช้ได้ */
  expires_month: string;
}

export interface HolidayLedgerInput {
  /** เดือนแรกที่เริ่มนับสิทธิ์ (เช่นเดือนที่เริ่มงาน) */
  from: string;
  /** ต้องครอบคลุมเดือนสุดท้ายที่มีใบลงไว้ ไม่งั้นวันที่จองล่วงหน้าไม่ถูกหัก */
  to: string;
  /** สิทธิ์ต่อเดือน — เดือนที่ไม่มีในนี้ = 0 */
  grants: ReadonlyMap<string, number>;
  /** วันที่ลงไว้แล้วต่อเดือน (รออนุมัติ + อนุมัติแล้ว) */
  usage: ReadonlyMap<string, number>;
  /** สิทธิ์ของแต่ละเดือนใช้ได้กี่เดือน นับรวมเดือนนั้น — ไม่ใส่ = HOLIDAY_VALID_MONTHS (3) */
  validMonths?: number;
  /** ตัดตามรอบปี — สิทธิ์ของปี Y ใช้ได้ถึงสิ้นเดือนที่ C ของปีถัดไป (0 = สิ้น ธ.ค. ปีเดียวกัน) · ไม่ใส่/null = ไม่ตัด */
  yearCarryMonths?: number | null;
}

/**
 * ลงเพิ่มได้อีกกี่วันในเดือนนั้น และมาจากถังไหนบ้าง
 *
 * ไม่ใช่แค่ผลรวมถังของเดือนนั้น: ถ้าจองวันในเดือนถัดไปไว้แล้วโดยอาศัยสิทธิ์ที่ทบมา
 * การใช้เพิ่มเดือนนี้จะทำให้ใบเดือนถัดไปเกินสิทธิ์ ⇒ "ลงได้" คือจำนวนที่ไม่ทำให้เดือนไหนเกินเพิ่ม
 * การใช้เกินในอดีต (ก่อนเปิดกฎนี้) ไม่นับเป็นหนี้ — ไม่งั้นทุกคนจะติดลบตั้งแต่วันแรก
 */
export function holidayAvailability(
  input: HolidayLedgerInput,
  month: string,
): { available_days: number; buckets: HolidayBucket[]; grants: HolidayGrant[] } {
  const from = monthIndex(input.from);
  const target = monthIndex(month);
  const to = Math.max(monthIndex(input.to), target);
  if (target < from) return { available_days: 0, buckets: [], grants: [] };

  const validMonths = validMonthsOf(input.validMonths);
  const yearCarry = yearCarryOf(input.yearCarryMonths);
  const grantOf = (index: number): number => input.grants.get(monthOfIndex(index)) ?? 0;
  const run = (extra: number): Simulation =>
    simulate(from, to, grantOf, (index) => (input.usage.get(monthOfIndex(index)) ?? 0) + (index === target ? extra : 0), validMonths, yearCarry);

  const base = run(0);
  const buckets = base.bucketsAt.get(target) ?? [];
  // ไล่ลงทีละครึ่งวัน (ลาครึ่งวันได้) จากยอดในถัง จนเจอจำนวนที่ไม่ทำให้เดือนไหนเกินเพิ่ม
  let available = Math.floor(buckets.reduce((sum, bucket) => sum + bucket.remaining_days, 0) * 2) / 2;
  while (available > 0 && run(available).deficit > base.deficit + 1e-9) available -= 0.5;
  // buckets ตัดเดือนที่ใช้หมดแล้วทิ้ง — grants เก็บไว้ครบทุกเดือนในช่วงใช้ได้ คนดูจะเห็นว่า "ได้ 4 ใช้ไป 4"
  const grants: HolidayGrant[] = [];
  for (let month = Math.max(from, target - validMonths + 1); month <= target; month += 1) {
    const granted = grantOf(month);
    if (granted <= 0) continue;
    // หมดอายุตามรอบปีไปแล้ว (เช่นของ ธ.ค. ตอนดู ก.พ.) — ไม่อยู่ในช่วงใช้ได้
    if (expiryIndex(month, validMonths, yearCarry) < target) continue;
    const left = buckets.find((bucket) => bucket.month === monthOfIndex(month))?.remaining_days ?? 0;
    grants.push({
      month: monthOfIndex(month),
      granted_days: granted,
      remaining_days: left,
      expires_month: monthOfIndex(expiryIndex(month, validMonths, yearCarry)),
    });
  }
  return { available_days: Math.max(0, available), buckets, grants };
}
