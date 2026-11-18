import { NextResponse } from "next/server";
import { getSession } from "@smartboss/auth";
import { wfFetch, WorkforceError, WorkforceUnavailableError } from "@/modules/hr/lib/api";
import { localDateStr, todayIso } from "@/modules/hr/lib/date";
import { CARRY_OVER_HOURS, clockState } from "@/modules/hr/lib/clock-state";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { addedPunches, todayShift } from "@/modules/hr/lib/today-clock-data";
export type { TodayShift } from "@/modules/hr/lib/today-clock-data";
import { syncUserToWorkforce } from "@/modules/admin/data/user-guards";

export const runtime = "nodejs";

interface Me {
  employment_id: string | null;
  display_name: string;
}

interface TimeEvent {
  id: string;
  employment_id: string;
  captured_at: string;
  event_intent: string;
  source_type: string;
  late_minutes: number;
}

/**
 * คนนี้ผูกกะทำงานไว้ไหม = "ต้องลงเวลาเข้า-ออก" (เจ้าของงานตัดสิน 2026-10-07: ไอคอนลงเวลาขึ้นเฉพาะคนที่ต้องสแกน)
 * นับทั้งตารางประจำสัปดาห์ที่ยังมีผล และตารางที่ประกาศรายวันช่วง ±7 วัน — คนในทะเบียนพนักงานที่ไม่ได้ผูกกะเลย
 * (เช่น ผู้บริหาร) ระบบบุคคลไม่คิดสาย/ขาดให้อยู่แล้ว จึงไม่ต้องเห็นปุ่ม
 * อ่านไม่ได้ = ถือว่าต้องลง (โชว์ไอคอนไว้ก่อน ดีกว่าคนที่ต้องลงหาปุ่มไม่เจอ)
 */
async function hasShift(orgId: string | null | undefined, employmentId: string, today: string): Promise<boolean> {
  if (!orgId) return true;
  try {
    const rows = await withWorkforceTenant(orgId, (tx) =>
      tx.$queryRaw<{ tracked: boolean }[]>`
        SELECT (
          EXISTS (
            SELECT 1 FROM workforce.recurring_work_patterns p
            WHERE p.employment_id = ${employmentId}::uuid
              AND p.effective_from <= ${today}::date
              AND (p.effective_to IS NULL OR p.effective_to >= ${today}::date)
          ) OR EXISTS (
            SELECT 1 FROM workforce.shift_assignments a
            WHERE a.employment_id = ${employmentId}::uuid
              AND a.work_date BETWEEN ${today}::date - 7 AND ${today}::date + 7
          )
        ) AS tracked
      `
    );
    return rows[0]?.tracked ?? true;
  } catch (error) {
    console.error("[m/today] hasShift lookup failed", error);
    return true;
  }
}

/**
 * สถานะการลงเวลาของ *ตัวเอง* วันนี้
 *
 * ไม่มี endpoint `/me/time-events` ใน workforce — ใช้ `/time-events?date=` ซึ่ง
 * เปิดให้ทุกคนที่ล็อกอินอ่านได้โดยตั้งใจ (attendance.controller.ts:224
 * "ทุกคนควรเห็นว่าใครมาถึงแล้ว") แล้วกรองเหลือของตัวเองฝั่งนี้
 *
 * ⚠ กรองด้วย `employment_id` ที่ได้จาก `/me` เท่านั้น **ห้ามรับ employment_id
 * จาก query string** ไม่งั้นใครก็ดูของคนอื่นผ่านหน้านี้ได้
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  }

  const date = todayIso();

  try {
    let me = await wfFetch<Me>("/me");
    // ยังไม่ผูกกับทะเบียนพนักงาน — ลองผูกบัญชีนี้คนเดียวก่อน (อีเมลต่างกันแค่ตัวพิมพ์เล็ก/ใหญ่ เช่น joey@ กับ Joey@
    // เคยผูกไม่ได้ ต้องให้แอดมินกดบันทึกผู้ใช้เอง) · คนที่ผูกแล้วไม่ผ่านทางนี้ ทำงานเหมือนเดิม
    if (me.employment_id === null && session.orgId) {
      await syncUserToWorkforce(session.userId, session.orgId, session.userId);
      me = await wfFetch<Me>("/me");
    }
    if (me.employment_id === null) {
      return NextResponse.json(
        {
          error:
            "บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน — แจ้งฝ่ายบุคคลให้เพิ่มคุณเข้าทะเบียนพนักงานก่อน",
          code: "NO_EMPLOYMENT",
        },
        { status: 409 },
      );
    }

    const yesterday = localDateStr(new Date(Date.now() - 86_400_000));
    const [timeline, prevTimeline] = await Promise.all([
      wfFetch<{ items: TimeEvent[] }>(`/time-events?date=${date}`),
      // กะดึก: เข้าเมื่อวานแล้วจะออกหลังเที่ยงคืน — ไม่ดูเมื่อวานด้วย ปุ่มจะขึ้น "เข้างาน" ให้กดผิด
      wfFetch<{ items: TimeEvent[] }>(`/time-events?date=${yesterday}`).catch(() => ({ items: [] as TimeEvent[] })),
    ]);
    const toEvent = (event: TimeEvent) => ({
      id: event.id,
      capturedAt: event.captured_at,
      intent: event.event_intent,
      sourceType: event.source_type,
      lateMinutes: event.late_minutes,
    });
    const mineOf = (items: TimeEvent[]) =>
      items
        .filter((event) => event.employment_id === me.employment_id)
        .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime())
        .map(toEvent);
    // เวลาที่แก้แล้ว (ADD_PUNCH อนุมัติ) นับด้วย — /time-events คืนแค่สแกนจริง ⇒ คนที่ HR เพิ่ม "เข้า 08:00"
    // ให้ (เช่นวันเซิร์ฟเวอร์ล่ม 16 ต.ค. 69) กดออกครั้งแรกกลายเป็น "เข้างาน" สาย ต้องกดอีกรอบถึงออก
    const [added, prevAdded] = await Promise.all([
      addedPunches(session.orgId, me.employment_id, date),
      addedPunches(session.orgId, me.employment_id, yesterday),
    ]);
    const withAdded = (items: TimeEvent[], extra: TimeEvent[]) =>
      extra.length === 0 ? items : [...items, ...extra];
    const mine = mineOf(withAdded(timeline.items, added));
    const prev = clockState(mineOf(withAdded(prevTimeline.items, prevAdded)));
    // ยังค้างอยู่ในงานจากเมื่อวาน และเข้ามาไม่นานเกินกะหนึ่ง = กะข้ามคืน (นานกว่านั้น = ลืมกดออก)
    const carriedIn =
      prev.openedBy !== null &&
      Date.now() - new Date(prev.openedBy.capturedAt).getTime() < CARRY_OVER_HOURS * 3_600_000
        ? prev.openedBy
        : null;

    const shift = await todayShift(session.orgId, me.employment_id, date);
    return NextResponse.json({
      date,
      displayName: me.display_name,
      shift,
      events: mine,
      carriedIn,
      // คนนี้ "ต้องลงเวลา" ไหม — ไอคอนลงเวลาบนหน้าแรกโชว์เฉพาะคนที่ต้องลง (components/home/clock-tile.tsx)
      mustClock: mine.length > 0 || carriedIn !== null || (await hasShift(session.orgId, me.employment_id, date)),
    });
  } catch (error) {
    if (error instanceof WorkforceUnavailableError) {
      return NextResponse.json(
        { error: "ระบบบุคคลไม่พร้อมใช้งานชั่วคราว ลองใหม่อีกครั้ง", code: "UNAVAILABLE" },
        { status: 503 },
      );
    }
    if (error instanceof WorkforceError) {
      return NextResponse.json(
        { error: error.displayMessage },
        { status: error.status },
      );
    }
    throw error;
  }
}
