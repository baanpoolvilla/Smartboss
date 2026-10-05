/**
 * สิทธิ์ Holiday แบบสะสม — คิดเป็น "ถัง" รายเดือน
 *
 * แต่ละเดือนได้สิทธิ์เท่าจำนวนวันหยุดบริษัทของเดือนนั้น (หรือจำนวนที่ HR กำหนดทับ)
 * สิทธิ์ของเดือน M ใช้ได้ภายใน HOLIDAY_VALID_MONTHS เดือนนับรวมเดือน M เอง (ก.ค. → ใช้ได้ถึงสิ้น ก.ย.) เกินนั้นตัดทิ้ง
 * การใช้ตัดจากถังที่เก่าที่สุดก่อน (ของที่ใกล้หมดอายุถูกใช้ก่อน ไม่เสียสิทธิ์โดยไม่จำเป็น)
 *
 * ไม่เก็บยอดคงเหลือเป็นตัวเลข — คำนวณใหม่จากสิทธิ์รายเดือนกับใบที่ลงไว้ทุกครั้ง
 * HR แก้จำนวนวันของเดือนย้อนหลัง หรือมีคนยกเลิกวันหยุด ยอดก็ถูกเองโดยไม่ต้องปรับบัญชี
 */
export const HOLIDAY_VALID_MONTHS = 3;

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
): Simulation {
  let buckets: { month: number; left: number }[] = [];
  let deficit = 0;
  const bucketsAt = new Map<number, HolidayBucket[]>();
  for (let month = from; month <= to; month += 1) {
    buckets = buckets.filter((bucket) => month - bucket.month < HOLIDAY_VALID_MONTHS);
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
          expires_month: monthOfIndex(bucket.month + HOLIDAY_VALID_MONTHS - 1),
        })),
    );
  }
  return { deficit, bucketsAt };
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
): { available_days: number; buckets: HolidayBucket[] } {
  const from = monthIndex(input.from);
  const target = monthIndex(month);
  const to = Math.max(monthIndex(input.to), target);
  if (target < from) return { available_days: 0, buckets: [] };

  const grantOf = (index: number): number => input.grants.get(monthOfIndex(index)) ?? 0;
  const run = (extra: number): Simulation =>
    simulate(from, to, grantOf, (index) => (input.usage.get(monthOfIndex(index)) ?? 0) + (index === target ? extra : 0));

  const base = run(0);
  const buckets = base.bucketsAt.get(target) ?? [];
  // ไล่ลงทีละครึ่งวัน (ลาครึ่งวันได้) จากยอดในถัง จนเจอจำนวนที่ไม่ทำให้เดือนไหนเกินเพิ่ม
  let available = Math.floor(buckets.reduce((sum, bucket) => sum + bucket.remaining_days, 0) * 2) / 2;
  while (available > 0 && run(available).deficit > base.deficit + 1e-9) available -= 0.5;
  return { available_days: Math.max(0, available), buckets };
}
