import "server-only";
import { prisma } from "@smartboss/database";

import {
  ABSENCE_THRESHOLD_MINUTES,
  ATTENDANCE_LOOKBACK_DAYS,
  loadPerformanceSettingsMap,
  recordPerformanceEvents,
  type PerformanceEventInput,
} from "@/lib/performance";

/**
 * ดึงผลลงเวลาจาก workforce มาเป็นคะแนนผลงาน
 *
 * ทำไมอ่านฐานข้อมูลตรงแทนที่จะเรียก workforce API: งานนี้รันจาก cron ซึ่งไม่มี
 * session ของผู้ใช้ จะออก token ให้ตัวเองก็ต้องรู้ความลับของ auth อยู่ดี
 * และทั้งสองระบบใช้ฐานข้อมูลเดียวกัน การอ่านอย่างเดียวข้ามสคีมาจึงตรงกว่า
 *
 * ⚠ ห้ามอ่านตารางฝั่ง workforce ตรง ๆ — ทุกใบเปิด FORCE ROW LEVEL SECURITY
 * และ Prisma ต่อด้วย user ที่ไม่มี tenant context จึงจะได้ 0 แถวเสมอ **โดยไม่มี
 * error ให้เห็น** ต้องเรียกผ่านฟังก์ชัน workforce.performance_attendance()
 * ซึ่งเป็น SECURITY DEFINER ที่เจ้าของอ่านข้ามบริษัทได้เฉพาะ 3 ตารางที่จำเป็น
 * (ติดตั้งด้วย packages/workforce/db/sql/04-performance-lookup.sql)
 *
 * ⚠ อ่านอย่างเดียวเท่านั้น — การเขียนลง workforce ต้องผ่าน API เสมอ เพราะที่นั่น
 * มี RLS, การตรวจสิทธิ์ และ audit ที่ SQL ตรงจะข้ามไปหมด
 *
 * เส้นทางแปลงคนกลับไปเป็นผู้ใช้ Smartboss:
 *   attendance_results.employment_id → employments.person_id
 *     → principals.person_id → principals.subject (= core.users.id)
 * เส้น principals.person_id ถูกเติมโดย `pnpm wf:sync` (จับคู่ด้วยอีเมล)
 */

interface AttendanceRow {
  user_id: string;
  work_date: Date;
  late_minutes: number;
  absence_minutes: number;
  missing_punch: boolean;
}

/**
 * เกณฑ์สายตั้งค่าได้รายบริษัท (lateThresholdMinutes) — ที่นี่เป็นงานข้ามบริษัท
 * จึงต้องดึงด้วยเกณฑ์ที่ "ผ่อนผันน้อยที่สุด" ในระบบก่อน แล้วค่อยกรองตามเกณฑ์
 * ของแต่ละบริษัททีหลัง ถ้าดึงด้วยเกณฑ์ของบริษัทใดบริษัทหนึ่ง บริษัทที่เข้มกว่า
 * จะตกหล่น
 *
 * เส้นแบ่งขาดงาน (ABSENCE_THRESHOLD_MINUTES) กับช่วงย้อนดู
 * (ATTENDANCE_LOOKBACK_DAYS) ตรึงไว้ตายตัว ไม่ตั้งค่าต่อบริษัท
 */
export async function dockAttendance(): Promise<{
  scanned: number;
  recorded: number;
}> {
  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  if (orgs.length === 0) return { scanned: 0, recorded: 0 };

  const settingsByOrg = await loadPerformanceSettingsMap(orgs.map((o) => o.id));
  const active = [...settingsByOrg.values()].filter((s) => s.enabled);
  if (active.length === 0) return { scanned: 0, recorded: 0 };

  const minLate = Math.min(...active.map((s) => s.lateThresholdMinutes));

  const from = new Date();
  from.setDate(from.getDate() - ATTENDANCE_LOOKBACK_DAYS);

  /*
   * ห้ามตัดสิน "วันนี้" (ของตอนที่ cron รันอยู่) เด็ดขาด — attendance_results
   * ของวันที่ยังไม่จบกะเชื่อไม่ได้เลย เพราะแถวนั้นคำนวณใหม่ทุกครั้งที่มีคนเปิด
   * /hr (autoRecalculateAttendance ย้อนหลัง 30 วันรวมวันนี้) ถ้าใครเปิด /hr
   * ตอนเช้าก่อนพนักงานตอกบัตรเข้า netWorkedMinutes ตอนนั้น = 0 ⇒ absence_minutes
   * เท่ากับความยาวกะเต็มวันทันที (พบจริง: พนักงานเข้า-ออกงานปกติทุกวัน แต่ระบบ
   * บันทึก "ขาดงาน 9 ชั่วโมง" เพราะ cron 08:00 น. อ่านค่านั้นไปก่อนที่ค่าจะถูก
   * คำนวณใหม่ให้ถูกต้องตอนสาย ๆ) เหตุการณ์ที่บันทึกไปแล้วแก้ไม่ได้อีก (กันซ้ำด้วย
   * unique key ถาวร) จึงต้องกันไว้ที่ต้นทาง — รอให้วันนั้น "จบ" ก่อนเสมอ แล้วให้
   * cron รอบถัดไป (พรุ่งนี้) ค่อยเก็บวันนี้แทน ตอนนั้นค่าควรนิ่งแล้วเพราะมีคน
   * เปิด /hr ระหว่างวันไปแล้วอย่างน้อยหนึ่งครั้งตามปกติ
   *
   * ใช้เวลาไทยตรง ๆ (ไม่ใช่ UTC ของเซิร์ฟเวอร์) เพราะกะทำงานอิงเวลาไทย —
   * ระบบนี้เป็น Thailand-only อยู่แล้ว (ปฏิทินพุทธ, cron อิงเวลาไทยใน docs/deploy.md)
   */
  const todayInThailand = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
  }).format(new Date());

  // เงื่อนไข (ฉบับปัจจุบัน, ไม่ใช่วันลา/วันหยุด) อยู่ในตัวฟังก์ชันแล้ว
  const rawRows = await prisma.$queryRaw<AttendanceRow[]>`
    SELECT subject AS user_id, work_date, late_minutes, absence_minutes, missing_punch
    FROM workforce.performance_attendance(
      ${from}::date, ${minLate}::int, ${ABSENCE_THRESHOLD_MINUTES}::int
    )
  `;
  const rows = rawRows.filter(
    (r) => new Date(r.work_date).toISOString().slice(0, 10) < todayInThailand,
  );

  if (rows.length === 0) return { scanned: 0, recorded: 0 };

  // subject คือ core.users.id — ยืนยันว่ายังมีอยู่จริงและอยู่บริษัทไหน
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.user_id))] } },
    select: { id: true, orgId: true },
  });
  const orgByUser = new Map(users.map((u) => [u.id, u.orgId]));

  const events: PerformanceEventInput[] = [];
  for (const r of rows) {
    const orgId = orgByUser.get(r.user_id);
    if (!orgId) continue; // ผู้ใช้ถูกลบ หรือเป็นผู้ใช้ระดับแพลตฟอร์มที่ไม่สังกัดบริษัท

    // กรองอีกชั้นด้วยเกณฑ์ของบริษัทคนนั้นจริง ๆ
    const st = settingsByOrg.get(orgId);
    if (!st || !st.enabled) continue;

    const day = new Date(r.work_date).toISOString().slice(0, 10);

    // สแกนแค่ครั้งเดียว = ขาดงานเต็มกะในผลลงเวลา แต่จะนับเป็นขาดงานไหมแล้วแต่บริษัทตั้ง
    // ไม่นับ = ตกไปเช็คมาสายตามเวลาที่สแกนเข้าต่อ
    const absent =
      Number(r.absence_minutes) > ABSENCE_THRESHOLD_MINUTES &&
      (!r.missing_punch || st.missingPunchCountsAsAbsent);
    if (absent) {
      events.push({
        orgId,
        userId: r.user_id,
        source: "workforce",
        category: "attendance_absent",
        occurredAt: new Date(r.work_date),
        refType: "attendance_day",
        refId: `${r.user_id}:${day}`,
        note: `ขาดงาน ${Math.round(Number(r.absence_minutes) / 60)} ชั่วโมง`,
      });
      continue; // ขาดงานแล้วไม่ต้องหักเรื่องสายซ้ำอีก
    }

    if (Number(r.late_minutes) > st.lateThresholdMinutes) {
      events.push({
        orgId,
        userId: r.user_id,
        source: "workforce",
        category: "attendance_late",
        occurredAt: new Date(r.work_date),
        refType: "attendance_day",
        refId: `${r.user_id}:${day}`,
        note: `สาย ${Number(r.late_minutes)} นาที`,
      });
    }
  }

  const recorded = await recordPerformanceEvents(events);
  return { scanned: rows.length, recorded };
}
