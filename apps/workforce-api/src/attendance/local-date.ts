import { schema } from '@workforce/db';
import { and, sql, type SQL } from 'drizzle-orm';

/**
 * สแกนที่เกิด "ในวันที่ from..to ตามเวลาท้องถิ่นของที่สแกน" (คอลัมน์ time_zone ของแต่ละแถว)
 *
 * เดิมกรองด้วย `${date}T00:00:00Z`..`T23:59:59Z` = วันตามเวลา UTC ⇒ ในไทย (UTC+7) สแกนก่อน 07:00 น.
 * ไปตกวันก่อนหน้า กระดาน "การลงเวลาวันนี้" เลยขึ้น "ขาดงาน" ทั้งที่สแกนเข้า 06:43 แล้ว และสแกนนั้นไปโผล่
 * ในกระดานของเมื่อวานแทน ส่วนรายงานรายเดือน (คิดวันตามเวลาท้องถิ่นถูกต้อง) ขึ้นปกติ — สองหน้าไม่ตรงกัน
 *
 * ช่วงหยาบ ±14 ชม. (โซนเวลากว้างสุดของโลก) ไว้ให้ใช้ index ของ captured_at ได้ แล้วค่อยเทียบวันท้องถิ่นจริง
 */
export function capturedOnLocalDates(from: string, to: string): SQL {
  const at = schema.rawTimeEvents.capturedAt;
  return and(
    sql`${at} >= ${`${from}T00:00:00Z`}::timestamptz - interval '14 hours'`,
    sql`${at} < ${`${to}T00:00:00Z`}::timestamptz + interval '38 hours'`,
    sql`(${at} AT TIME ZONE ${schema.rawTimeEvents.timeZone})::date BETWEEN ${from}::date AND ${to}::date`,
  )!;
}
