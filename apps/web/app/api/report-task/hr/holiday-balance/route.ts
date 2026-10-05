import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";
import { wfTry, type HolidayAllowance, type LeaveType, type Paged } from "@/modules/hr/lib/api";

export const dynamic = "force-dynamic";

/**
 * ยอด Holiday (แบบสะสม) ที่ผู้ใช้ปัจจุบันยังลงได้ในเดือนที่ถาม — ของใครของมัน ดึงจากฝ่ายบุคคล (workforce)
 * ใช้กับการ์ด "วันหยุดของฉัน" ในปฏิทินของโมดูลรายงานและงาน
 *
 * items ว่าง = บริษัทไม่ได้ใช้ Holiday แบบสะสม (หรือบัญชีนี้ยังไม่ผูกทะเบียนพนักงาน) ⇒ การ์ดไม่แสดงช่องนี้
 * expiringDays = ส่วนที่ต้องใช้ภายในเดือนนี้ ไม่งั้นถูกตัดทิ้ง
 */
export async function GET(request: NextRequest) {
  try {
    await requireOrg();
    const month = new URL(request.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return Response.json({ error: "month ต้องเป็นรูปแบบ YYYY-MM" }, { status: 400 });
    }

    const [types, allowances] = await Promise.all([
      wfTry<Paged<LeaveType>>("/leave-types"),
      wfTry<{ items: HolidayAllowance[] }>(`/me/holiday-allowances?from=${month}&to=${month}`),
    ]);
    const nameOf = new Map((types?.items ?? []).map((t) => [t.id, t.name]));

    return Response.json({
      items: (allowances?.items ?? []).map((a) => {
        const current = a.months[0];
        return {
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
