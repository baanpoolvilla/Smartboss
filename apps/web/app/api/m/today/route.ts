import { NextResponse } from "next/server";
import { getSession } from "@smartboss/auth";
import { wfFetch, WorkforceError, WorkforceUnavailableError } from "@/modules/hr/lib/api";
import { todayIso } from "@/modules/hr/lib/date";

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
    const me = await wfFetch<Me>("/me");
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

    const timeline = await wfFetch<{ items: TimeEvent[] }>(`/time-events?date=${date}`);
    const mine = timeline.items
      .filter((event) => event.employment_id === me.employment_id)
      .sort((a, b) => a.captured_at.localeCompare(b.captured_at));

    return NextResponse.json({
      date,
      displayName: me.display_name,
      events: mine.map((event) => ({
        id: event.id,
        capturedAt: event.captured_at,
        intent: event.event_intent,
        sourceType: event.source_type,
        lateMinutes: event.late_minutes,
      })),
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
