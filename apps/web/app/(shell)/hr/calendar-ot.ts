import "server-only";

import { withRequestsTenant } from "@/modules/requests/lib/db";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import type { OtMark } from "./leave/leave-calendar";

/**
 * OT ที่อนุมัติแล้วของเดือนนั้น สำหรับปฏิทินทีม — ใครมาทำ OT วันไหน (รวมคนที่ลง Day-Off แต่มาทำ)
 *
 * สองแหล่ง: ใบ OT ในเบิกจ่าย & OT (อนุมัติ/จ่ายแล้ว — มีเวลาเริ่ม–เลิก) กับ OT ที่ HR อนุมัติจากเวลาสแกน
 * ตัวหลังที่มีใบผูกอยู่แล้ว (hrOvertimeRequestId) ไม่นับซ้ำ · แสดงแค่ชั่วโมง ไม่แสดงเงิน
 */
export async function loadOtMarks(
  orgId: string,
  from: string,
  to: string,
  nameOf: (employmentId: string, fallback: string) => string,
): Promise<Record<string, OtMark[]>> {
  const [money, hr] = await Promise.all([
    withRequestsTenant(orgId, (tx) =>
      tx.moneyRequest.findMany({
        where: {
          orgId,
          kind: "ot",
          status: { in: ["approved", "paid"] },
          employmentId: { not: null },
          workDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
        select: { employmentId: true, beneficiaryName: true, workDate: true, otStart: true, otEnd: true, otMinutes: true, hrOvertimeRequestId: true },
      }),
    ).catch(() => []),
    withWorkforceTenant(orgId, (tx) =>
      tx.$queryRawUnsafe<{ id: string; employment_id: string; day: string; minutes: number }[]>(
        `SELECT id::text AS id, employment_id::text AS employment_id, to_char(work_date, 'YYYY-MM-DD') AS day, approved_minutes AS minutes
           FROM workforce.overtime_requests
          WHERE status = 'FINAL_APPROVED' AND approved_minutes > 0
            AND work_date BETWEEN $1::date AND $2::date`,
        from,
        to,
      ),
    ).catch(() => []),
  ]);

  const byKey = new Map<string, { day: string; employmentId: string; name: string; minutes: number; times: string[] }>();
  const add = (day: string, employmentId: string, name: string, minutes: number, time: string | null) => {
    const key = `${employmentId}|${day}`;
    const row = byKey.get(key) ?? { day, employmentId, name: nameOf(employmentId, name), minutes: 0, times: [] };
    row.minutes += minutes;
    if (time) row.times.push(time);
    byKey.set(key, row);
  };
  const linked = new Set(money.map((m) => m.hrOvertimeRequestId).filter((id): id is string => !!id));
  for (const m of money) {
    add(m.workDate.toISOString().slice(0, 10), m.employmentId!, m.beneficiaryName, m.otMinutes ?? 0, m.otStart && m.otEnd ? `${m.otStart}–${m.otEnd}` : null);
  }
  for (const r of hr) {
    if (!linked.has(r.id)) add(r.day, r.employment_id, "", r.minutes, null);
  }

  const out: Record<string, OtMark[]> = {};
  for (const row of byKey.values()) {
    if (row.minutes <= 0) continue;
    (out[row.day] ??= []).push({
      employmentId: row.employmentId,
      name: row.name,
      minutes: row.minutes,
      times: row.times.length > 0 ? row.times.sort().join(", ") : null,
    });
  }
  return out;
}
