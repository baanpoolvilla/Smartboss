import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";
import { wfTry, type HolidayAllowance, type LeaveRequest, type LeaveType, type Paged } from "@/modules/hr/lib/api";
import { listHolidayEvents } from "@/modules/report_task/lib/db/workforce-calendar";

export const dynamic = "force-dynamic";

/**
 * ยอด Holiday (แบบสะสม) ที่ผู้ใช้ปัจจุบันยังลงได้ในเดือนที่ถาม — ของใครของมัน ดึงจากฝ่ายบุคคล (workforce)
 * ใช้กับการ์ด "วันหยุดของฉัน" ในปฏิทินของโมดูลรายงานและงาน
 *
 * items ว่าง = บริษัทไม่ได้ใช้ Holiday แบบสะสม (หรือบัญชีนี้ยังไม่ผูกทะเบียนพนักงาน) ⇒ การ์ดไม่แสดงช่องนี้
 * expiringDays = ส่วนที่ต้องใช้ภายในเดือนนี้ ไม่งั้นถูกตัดทิ้ง
 *
 * ?detail=1 (กดดูรายละเอียดในการ์ด — holiday-detail-dialog.tsx) เพิ่ม:
 *   grants = สิทธิ์แต่ละเดือนที่ยังอยู่ในช่วงใช้ได้ (ได้/เหลือ/ใช้ได้ถึง) พร้อมชื่อวันหยุดที่ทำให้ได้สิทธิ์นั้น
 *   used   = วันที่ลง Holiday ไปแล้วในช่วงเดียวกัน (รออนุมัติ + อนุมัติแล้ว — นับเป็นการใช้เหมือนฝั่งระบบบุคคล)
 * ไม่ส่งมาตลอดเพราะการ์ดโหลดทุกครั้งที่เปลี่ยนเดือน แต่รายละเอียดเปิดดูนาน ๆ ครั้ง
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireOrg();
    const params = new URL(request.url).searchParams;
    const month = params.get("month") ?? "";
    const detail = params.get("detail") === "1";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return Response.json({ error: "month ต้องเป็นรูปแบบ YYYY-MM" }, { status: 400 });
    }

    const [types, allowances] = await Promise.all([
      wfTry<Paged<LeaveType>>("/leave-types"),
      wfTry<{ items: HolidayAllowance[] }>(`/me/holiday-allowances?from=${month}&to=${month}`),
    ]);
    const nameOf = new Map((types?.items ?? []).map((t) => [t.id, t.name]));

    // รายละเอียด: ช่วงเดือนที่สิทธิ์ยังใช้ได้ = 2 เดือนก่อนหน้า ถึงเดือนนี้ (HOLIDAY_VALID_MONTHS = 3)
    let holidaysByMonth = new Map<string, { date: string; name: string }[]>();
    let requests: LeaveRequest[] = [];
    if (detail && (allowances?.items ?? []).length > 0) {
      const [y, m] = month.split("-").map(Number) as [number, number];
      const windowStart = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
      const windowEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const [holidays, mine] = await Promise.all([
        listHolidayEvents(session.orgId, windowStart, windowEnd),
        wfTry<{ items: LeaveRequest[] }>(`/me/leave-requests?from=${windowStart}&to=${windowEnd}`),
      ]);
      holidaysByMonth = new Map();
      for (const h of holidays) {
        const date = h.start.slice(0, 10);
        const list = holidaysByMonth.get(date.slice(0, 7)) ?? [];
        if (!list.some((x) => x.date === date)) list.push({ date, name: h.title });
        holidaysByMonth.set(date.slice(0, 7), list);
      }
      requests = mine?.items ?? [];
    }

    return Response.json({
      items: (allowances?.items ?? []).map((a) => {
        const current = a.months[0];
        const details = detail
          ? {
              grants: (current?.grants ?? []).map((g) => ({
                month: g.month,
                grantedDays: g.granted_days,
                remainingDays: g.remaining_days,
                expiresMonth: g.expires_month,
                holidays: (holidaysByMonth.get(g.month) ?? []).sort((x, y) => x.date.localeCompare(y.date)),
              })),
              used: requests
                .filter((r) => r.leave_type_id === a.leave_type_id && (r.status === "APPROVED" || r.status === "SUBMITTED"))
                .map((r) => ({ startsOn: r.starts_on, endsOn: r.ends_on, days: r.total_minutes / 480, pending: r.status === "SUBMITTED" }))
                .sort((x, y) => x.startsOn.localeCompare(y.startsOn)),
            }
          : {};
        return {
          ...details,
          leaveTypeId: a.leave_type_id,
          name: nameOf.get(a.leave_type_id) ?? "Holiday",
          availableDays: current?.available_days ?? 0,
          expiringDays: (current?.buckets ?? [])
            .filter((b) => b.expires_month === month)
            .reduce((sum, b) => sum + b.remaining_days, 0),
        };
      }),
    });
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    if (status === 500) console.error("[report-task/hr/holiday-balance GET]", err);
    return Response.json({ error: err instanceof Error ? err.message : "เชื่อมต่อระบบบุคคลไม่ได้" }, { status });
  }
}
