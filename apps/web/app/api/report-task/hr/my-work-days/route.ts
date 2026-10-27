import type { NextRequest } from "next/server";
import { requireOrg } from "@smartboss/auth";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { loadRequests, withRequestsTenant } from "@/modules/requests/lib/db";

export const dynamic = "force-dynamic";

/**
 * วันมาทำงาน / ขาด / สาย / OT ของผู้ใช้ปัจจุบันในช่วงที่ปฏิทินแสดง — ของใครของมัน
 * ใช้กับการ์ด "วันหยุดของฉัน" ในปฏิทินทีม (ผู้ใช้ขอ 27/10/2569 "สรุปวันทำงานในเดือนนั้น ทำไปกี่วัน หยุดกี่วัน มาทำ OT กี่วัน")
 * มาทำงาน/ขาด/สาย = ผลลงเวลาของระบบบุคคล (เกณฑ์เดียวกับรอบเงินเดือน salary/lib/inputs.ts)
 * OT = ใบ OT ที่อนุมัติ/จ่ายแล้วในโมดูลเบิกจ่าย & OT
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD (to ไม่รวมวันนั้น เหมือนช่วงของปฏิทิน)
 * tracked=false = บัญชีนี้ไม่ได้ผูกทะเบียนพนักงาน ⇒ การ์ดไม่แสดงช่องเหล่านี้
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireOrg();
    const params = new URL(request.url).searchParams;
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return Response.json({ error: "from/to ต้องเป็นรูปแบบ YYYY-MM-DD" }, { status: 400 });
    }

    const att = await withWorkforceTenant(session.orgId, (tx) =>
      tx.$queryRaw<{ employment_id: string; worked_days: number; late_days: number; absent_days: number }[]>`
        SELECT e.id::text AS employment_id,
               count(ar.*) FILTER (WHERE ar.actual_in_at IS NOT NULL)::int AS worked_days,
               count(ar.*) FILTER (WHERE ar.late_minutes > 0)::int AS late_days,
               count(ar.*) FILTER (WHERE ar.absence_minutes > 0 AND ar.actual_in_at IS NULL AND NOT ar.is_on_leave AND NOT ar.is_rest_day AND NOT ar.is_holiday)::int AS absent_days
          FROM workforce.principals p
          JOIN workforce.employments e ON e.person_id = p.person_id
          LEFT JOIN workforce.attendance_results ar
                 ON ar.employment_id = e.id AND ar.is_current
                AND ar.work_date >= ${from}::date AND ar.work_date < ${to}::date
         WHERE p.subject = ${session.userId}
         GROUP BY e.id
      `
    );
    if (att.length === 0) return Response.json({ tracked: false });

    const ot = await withRequestsTenant(session.orgId, (tx) =>
      loadRequests(tx, session.orgId, {
        kind: "ot",
        status: { in: ["approved", "paid"] },
        beneficiaryUserId: session.userId,
        workDate: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) },
      }),
    );

    return Response.json({
      tracked: true,
      workedDays: att.reduce((s, r) => s + r.worked_days, 0),
      lateDays: att.reduce((s, r) => s + r.late_days, 0),
      absentDays: att.reduce((s, r) => s + r.absent_days, 0),
      otDays: new Set(ot.map((r) => r.workDate)).size,
      otMinutes: ot.reduce((s, r) => s + (r.otMinutes ?? 0), 0),
    });
  } catch (error) {
    console.error("[my-work-days]", error);
    return Response.json({ tracked: false });
  }
}
