import "server-only";
import { prisma } from "@smartboss/database";

export type RosterState = "WORKING" | "OFF" | "LEAVE" | "HOLIDAY" | "NO_SHIFT";

/**
 * ถาม HR roster ว่า "วันนี้พนักงานคนนี้อยู่สถานะไหน" (subject = core.users.id)
 * ผ่านฟังก์ชัน SECURITY DEFINER workforce.report_working_days (ข้าม RLS ได้)
 *
 * null = ไม่มีข้อมูลของวันนั้น หรือฟังก์ชัน/ตาราง workforce ยังไม่พร้อม
 * (เช่นยังไม่รัน 05-report-working-days.sql) — ผู้เรียก fallback ไป requiredWeekdays
 * ทำให้ระบบยังทำงานได้แม้ยังไม่ได้ตั้งฝั่ง workforce
 */
export async function getRosterState(subject: string, date: string): Promise<RosterState | null> {
  try {
    const rows = await prisma.$queryRaw<{ state: string }[]>`
      SELECT state
      FROM workforce.report_working_days(${date}::date, ${date}::date)
      WHERE subject = ${subject}
      LIMIT 1`;
    return (rows[0]?.state as RosterState | undefined) ?? null;
  } catch {
    // ฟังก์ชันยังไม่ถูกติดตั้ง หรือ workforce ยังไม่ได้ตั้งค่า → ให้ fallback
    return null;
  }
}
