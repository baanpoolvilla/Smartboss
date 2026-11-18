import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";

/** ย้ายมาจาก app/api/m/today/route.ts (ไฟล์ route export ฟังก์ชันอื่นไม่ได้) — ใช้ร่วมกับ /api/m/checkin */

export interface AddedPunchEvent {
  id: string;
  employment_id: string;
  captured_at: string;
  event_intent: string;
  source_type: string;
  late_minutes: number;
}

/**
 * เวลาเข้า/ออกที่ HR เพิ่มให้แล้ว (คำขอแก้เวลาที่อนุมัติ, ADD_PUNCH) ของคนนี้ในวันนั้น — ในรูปเดียวกับ /time-events
 * อ่านไม่ได้ = ไม่มี (ปุ่มทำงานแบบเดิมจากสแกนจริงล้วน)
 */
export async function addedPunches(orgId: string | null | undefined, employmentId: string, workDate: string): Promise<AddedPunchEvent[]> {
  if (!orgId) return [];
  try {
    const rows = await withWorkforceTenant(orgId, (tx) =>
      tx.$queryRaw<{ id: string; punch_at: Date; event_intent: string | null }[]>`
        SELECT a.id::text, a.punch_at, a.event_intent::text
        FROM workforce.time_event_adjustments a
        WHERE a.employment_id = ${employmentId}::uuid
          AND a.work_date = ${workDate}::date
          AND a.status = 'APPROVED'
          AND a.adjustment_type = 'ADD_PUNCH'
          AND a.punch_at IS NOT NULL
      `
    );
    return rows.map((r) => ({
      id: r.id,
      employment_id: employmentId,
      captured_at: new Date(r.punch_at).toISOString(),
      event_intent: r.event_intent ?? "AUTO",
      source_type: "ADJUSTMENT",
      late_minutes: 0,
    }));
  } catch (error) {
    console.error("[m/today] addedPunches lookup failed", error);
    return [];
  }
}

export interface TodayShift {
  name: string;
  /** นาทีนับจากเที่ยงคืน (เวลาไทย) — end ≤ start = กะข้ามคืน เลิกวันถัดไป */
  startMinutes: number;
  endMinutes: number;
  restDay: boolean;
}

/**
 * กะของวันนี้ — กติกาเดียวกับระบบบุคคล (workforce-api attendance.repository.ts resolveShiftId):
 * ตารางรายวันที่ประกาศแล้ว (PUBLISHED) ชนะตารางประจำสัปดาห์ · ไว้บอกบนหน้าลงเวลาว่าเข้า/เลิกกี่โมง
 * ("อยากให้มีเวลาบอกด้วยว่ากี่โมง จะได้ไม่กดออกก่อน") · อ่านไม่ได้/ไม่มีกะ = null (หน้าจอแค่ไม่บอกเวลากะ)
 */
export async function todayShift(orgId: string | null | undefined, employmentId: string, today: string): Promise<TodayShift | null> {
  if (!orgId) return null;
  try {
    const rows = await withWorkforceTenant(orgId, (tx) =>
      tx.$queryRaw<{ name: string; start_minutes: number; end_minutes: number; rest_day: boolean }[]>`
        WITH picked AS (
          SELECT COALESCE(
            (SELECT a.shift_id FROM workforce.shift_assignments a
              WHERE a.employment_id = ${employmentId}::uuid AND a.work_date = ${today}::date AND a.status = 'PUBLISHED'
              LIMIT 1),
            (SELECT CASE EXTRACT(DOW FROM ${today}::date)::int
                      WHEN 0 THEN p.sunday_shift_id WHEN 1 THEN p.monday_shift_id WHEN 2 THEN p.tuesday_shift_id
                      WHEN 3 THEN p.wednesday_shift_id WHEN 4 THEN p.thursday_shift_id WHEN 5 THEN p.friday_shift_id
                      ELSE p.saturday_shift_id END
               FROM workforce.recurring_work_patterns p
              WHERE p.employment_id = ${employmentId}::uuid
                AND p.effective_from <= ${today}::date
                AND (p.effective_to IS NULL OR p.effective_to >= ${today}::date)
              ORDER BY p.effective_from DESC
              LIMIT 1)
          ) AS shift_id
        )
        SELECT s.name, s.start_minutes, s.end_minutes, s.rest_day
        FROM picked JOIN workforce.shift_definitions s ON s.id = picked.shift_id
      `
    );
    const r = rows[0];
    return r ? { name: r.name, startMinutes: Number(r.start_minutes), endMinutes: Number(r.end_minutes), restDay: r.rest_day } : null;
  } catch (error) {
    console.error("[m/today] todayShift lookup failed", error);
    return null;
  }
}

