import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@smartboss/auth";
import {
  wfFetch,
  wfTry,
  WorkforceError,
  WorkforceUnavailableError,
  type LeaveRequest,
  type LeaveType,
  type Paged,
} from "@/modules/hr/lib/api";

export const runtime = "nodejs";

/** เดือนที่ขอ — `YYYY-MM` · ไม่ส่งมา = เดือนปัจจุบันตามเวลาไทย */
function monthRange(month: string | null): { from: string; to: string; month: string } {
  const valid = month !== null && /^\d{4}-\d{2}$/.test(month);
  const base = valid
    ? `${month}-01`
    : new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 8) + "01";

  const start = new Date(`${base}T00:00:00Z`);
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0), // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้
  );

  return {
    from: base,
    to: end.toISOString().slice(0, 10),
    month: base.slice(0, 7),
  };
}

/**
 * วันหยุดของตัวเองในเดือนหนึ่ง
 *
 * ⚠ คำศัพท์: ในระบบนี้ "วันหยุด" ของพนักงาน (เดือนละ 4-6 วันตามสัญญาจ้าง)
 * ถูกเก็บด้วยกลไกเดียวกับใบลาของ workforce (`leave_requests`) เพราะทั้งคู่คือ
 * "วันที่ไม่ได้มาทำงานโดยได้รับอนุญาต" เหมือนกัน — แต่**ภาษาที่แสดงต่อพนักงาน
 * ต้องเป็น "วันหยุด" ไม่ใช่ "ลา"** เพราะสองอย่างนี้คนละเรื่องกันในความเข้าใจ
 * ของคนใช้งาน (ลา = ป่วย/ธุระ ต้องมีเหตุผล · วันหยุด = สิทธิ์ประจำเดือน)
 *
 * ใช้ `/me/leave-requests` ซึ่งเป็น endpoint แบบ self เท่านั้น — พนักงานเห็น
 * ของตัวเองอย่างเดียว ไม่ต้องมีสิทธิ์อ่านของคนอื่น
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  }

  const { from, to, month } = monthRange(req.nextUrl.searchParams.get("month"));

  try {
    const [mine, types] = await Promise.all([
      wfFetch<{ items: LeaveRequest[] }>(`/me/leave-requests?from=${from}&to=${to}`),
      // ชื่อประเภทเป็นของเสริม — อ่านไม่ได้ก็ยังแสดงปฏิทินได้ แค่ไม่มีป้ายชื่อ
      wfTry<Paged<LeaveType>>("/leave-types"),
    ]);

    const typeName = new Map((types?.items ?? []).map((type) => [type.id, type.name]));

    return NextResponse.json({
      month,
      from,
      to,
      items: mine.items
        // ยกเลิก/ถูกปฏิเสธแล้วไม่ใช่วันหยุดอีกต่อไป — ไม่ควรค้างอยู่บนปฏิทิน
        .filter((item) => item.status === "APPROVED" || item.status === "SUBMITTED")
        .map((item) => ({
          id: item.id,
          startsOn: item.starts_on,
          endsOn: item.ends_on,
          label: item.display_label || (typeName.get(item.leave_type_id) ?? "วันหยุด"),
          typeName: typeName.get(item.leave_type_id) ?? null,
          pending: item.status === "SUBMITTED",
        })),
    });
  } catch (error) {
    if (error instanceof WorkforceUnavailableError) {
      return NextResponse.json(
        { error: "ระบบบุคคลไม่พร้อมใช้งานชั่วคราว ลองใหม่อีกครั้ง" },
        { status: 503 },
      );
    }
    if (error instanceof WorkforceError) {
      return NextResponse.json({ error: error.displayMessage }, { status: error.status });
    }
    throw error;
  }
}
