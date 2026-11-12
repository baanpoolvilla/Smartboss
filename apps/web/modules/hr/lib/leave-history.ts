import "server-only";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";

/**
 * ประวัติการลง / ยกเลิก / สลับ / อนุมัติ วันหยุดในเดือน (ผู้ใช้ 31/10/2569 "อยากรู้ว่าใครลงใครยกเลิกหรือเลื่อน กันหยุดแล้วมาลบ")
 * อ่านจาก workforce.audit_events (append-only — แก้/ลบไม่ได้ทั้ง API และ DB) ผูกกับใบลาที่ทับเดือนนั้น
 * อ่านตรงจาก DB เพราะ /audit-events ต้องมี workforce.audit.read ซึ่ง HR_OFFICER ไม่มี — หน้าเรียกต้องเช็คสิทธิ์อนุมัติการลาเอง
 */
export interface LeaveHistoryRow {
  id: string;
  occurredAt: string;
  /** วันที่ (เวลาไทย) ที่กด */
  occurredOn: string;
  action: "submit" | "decide" | "cancel" | "relabel" | "other";
  actorName: string;
  /** คนกดคือเจ้าของวันหยุดเอง */
  byOwner: boolean;
  employmentId: string;
  ownerName: string;
  requestId: string;
  leaveTypeId: string;
  startsOn: string;
  endsOn: string;
  typeName: string;
  displayLabel: string;
  swapFromDate: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export async function loadLeaveHistory(orgId: string, from: string, to: string): Promise<LeaveHistoryRow[]> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<
      {
        id: string;
        occurred_at: Date;
        occurred_on: string;
        action: string;
        actor_type: string;
        actor_name: string | null;
        by_owner: boolean;
        employment_id: string;
        request_id: string;
        leave_type_id: string;
        owner_name: string;
        starts_on: string;
        ends_on: string;
        type_name: string | null;
        display_label: string;
        swap_from_date: string | null;
        reason: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }[]
    >(
      `SELECT a.id::text, a.occurred_at, to_char(a.occurred_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS occurred_on,
              a.action, a.actor_type, COALESCE(NULLIF(p.display_name, ''), NULLIF(a.actor_display, '')) AS actor_name,
              (p.person_id IS NOT NULL AND p.person_id = e.person_id) AS by_owner,
              lr.employment_id::text, lr.id::text AS request_id, lr.leave_type_id::text, COALESCE(NULLIF(pe.preferred_name, ''), pe.first_name, '') AS owner_name,
              to_char(lr.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(lr.ends_on, 'YYYY-MM-DD') AS ends_on,
              lt.name AS type_name, lr.display_label,
              to_char(lr.swap_from_date, 'YYYY-MM-DD') AS swap_from_date, a.reason, a.before, a.after
         FROM workforce.audit_events a
         JOIN workforce.leave_requests lr ON lr.id = a.resource_id
         JOIN workforce.employments e ON e.id = lr.employment_id
         LEFT JOIN workforce.people pe ON pe.id = e.person_id
         LEFT JOIN workforce.leave_types lt ON lt.id = lr.leave_type_id
         LEFT JOIN workforce.principals p ON p.id = a.actor_id
        WHERE a.resource_type = 'leave_request' AND a.outcome = 'SUCCESS'
          AND lr.starts_on <= $2::date AND lr.ends_on >= $1::date
        ORDER BY a.occurred_at DESC
        LIMIT 500`,
      from,
      to,
    ),
  );
  const kind = (a: string): LeaveHistoryRow["action"] =>
    a === "leave.request.submit" ? "submit" : a === "leave.request.decide" ? "decide" : a === "leave.request.cancel" ? "cancel" : a === "leave.request.relabel" ? "relabel" : "other";
  return rows.map((r) => ({
    id: r.id,
    occurredAt: new Date(r.occurred_at).toISOString(),
    occurredOn: r.occurred_on,
    action: kind(r.action),
    actorName: r.actor_type === "SYSTEM" ? "ระบบ" : (r.actor_name ?? "—"),
    byOwner: r.by_owner,
    employmentId: r.employment_id,
    requestId: r.request_id,
    leaveTypeId: r.leave_type_id,
    ownerName: r.owner_name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    typeName: r.type_name ?? "",
    displayLabel: r.display_label,
    swapFromDate: r.swap_from_date,
    reason: r.reason,
    before: r.before,
    after: r.after,
  }));
}

/**
 * "ลาพักร้อน · วันที่ 2/3" ต่อใบในประวัติ (ผู้ใช้ 12/11/2569 "อยากให้มีบอกลงวันหยุดแบบไหน … เช่น ลาพักร้อน 2/3")
 * ใบนี้เป็นวันที่เท่าไหร่ของสิทธิ์ — นับใบที่ยังมีผล (รออนุมัติ/อนุมัติ) ของคนเดียวกัน ประเภทเดียวกัน เรียงตามวันหยุด
 *   - ประเภทมีสิทธิ์รายปี (ลาพักร้อน): ทั้งปีปฏิทิน / วันที่ HR กรอกให้ปีนั้น — เฉพาะคนที่เห็นยอดรายปีได้ (HR/CEO)
 *   - ประเภทมีโควตาต่อเดือน (Day-Off): ในเดือนนั้น / โควตาของคนนั้นเดือนนั้น (เลขเดียวกับตอนกดลง)
 *   - ไม่มีโควตา: บอกแค่ "วันที่ n ของเดือน"
 * ใบที่ยกเลิก/ไม่อนุมัติไปแล้ว = "ไม่นับแล้ว" · อ่านอย่างเดียว ไม่แตะข้อมูล
 */
export interface LeaveUsage {
  /** ลำดับวันของใบนี้ เช่น 2 หรือ "2–3" ถ้าใบนี้กินหลายวัน */
  nth: string;
  quota: number | null;
  period: "year" | "month";
  counted: boolean;
}

export async function loadLeaveUsage(
  orgId: string,
  rows: LeaveHistoryRow[],
  opts: { showYearly: boolean; monthlyQuotaFor: (employmentId: string, leaveTypeId: string, month: string, typeDefault: number, isDayOff: boolean) => Promise<number> },
): Promise<Map<string, LeaveUsage>> {
  const out = new Map<string, LeaveUsage>();
  const reqIds = [...new Set(rows.map((r) => r.requestId))];
  if (reqIds.length === 0) return out;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

  const data = await withWorkforceTenant(orgId, async (tx) => {
    const reqs = await tx.$queryRawUnsafe<
      { id: string; employment_id: string; leave_type_id: string; starts_on: string; ends_on: string; total_minutes: number; status: string; created_at: Date;
        monthly_quota_days: number; yearly_entitlement: boolean; auto_approve: boolean; requires_reports: boolean; accrues_from_holidays: boolean }[]
    >(
      `SELECT lr.id::text, lr.employment_id::text, lr.leave_type_id::text, to_char(lr.starts_on,'YYYY-MM-DD') AS starts_on, to_char(lr.ends_on,'YYYY-MM-DD') AS ends_on,
              lr.total_minutes, lr.status, lr.created_at, lt.monthly_quota_days, lt.yearly_entitlement, lt.auto_approve, lt.requires_reports, lt.accrues_from_holidays
         FROM workforce.leave_requests lr JOIN workforce.leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.id = ANY($1::uuid[])`,
      reqIds,
    );
    if (reqs.length === 0) return { reqs, siblings: [], ledger: [] };
    const emps = [...new Set(reqs.map((r) => r.employment_id))];
    const types = [...new Set(reqs.map((r) => r.leave_type_id))];
    const years = [...new Set(reqs.map((r) => Number(r.starts_on.slice(0, 4))))];
    const from = `${Math.min(...years)}-01-01`;
    const to = `${Math.max(...years)}-12-31`;
    const siblings = await tx.$queryRawUnsafe<{ id: string; employment_id: string; leave_type_id: string; starts_on: string; ends_on: string; total_minutes: number; created_at: Date }[]>(
      `SELECT id::text, employment_id::text, leave_type_id::text, to_char(starts_on,'YYYY-MM-DD') AS starts_on, to_char(ends_on,'YYYY-MM-DD') AS ends_on, total_minutes, created_at
         FROM workforce.leave_requests
        WHERE employment_id = ANY($1::uuid[]) AND leave_type_id = ANY($2::uuid[])
          AND status IN ('SUBMITTED','APPROVED') AND starts_on <= $4::date AND ends_on >= $3::date`,
      emps, types, from, to,
    );
    const yearlyTypes = [...new Set(reqs.filter((r) => r.yearly_entitlement).map((r) => r.leave_type_id))];
    const ledger = opts.showYearly && yearlyTypes.length
      ? await tx.$queryRawUnsafe<{ employment_id: string; leave_type_id: string; period_year: number; minutes: number }[]>(
          `SELECT employment_id::text, leave_type_id::text, period_year, SUM(minutes)::int AS minutes
             FROM workforce.leave_balance_ledger
            WHERE employment_id = ANY($1::uuid[]) AND leave_type_id = ANY($2::uuid[]) AND period_year = ANY($3::int[])
              AND entry_type IN ('OPENING','ACCRUAL','ADJUST','EXPIRE')
            GROUP BY 1,2,3`,
          emps, yearlyTypes, years,
        )
      : [];
    return { reqs, siblings, ledger };
  });

  const entitled = new Map(data.ledger.map((l) => [`${l.employment_id}|${l.leave_type_id}|${l.period_year}`, l.minutes / 480]));
  // วันของใบที่ตกอยู่ในช่วง — ใบวันเดียวใช้นาทีจริง (ครึ่งวัน = 0.5) ใบหลายวันนับวันปฏิทินในช่วง
  const daysIn = (r: { starts_on: string; ends_on: string; total_minutes: number }, from: string, to: string) => {
    if (r.starts_on === r.ends_on) return r.starts_on >= from && r.starts_on <= to ? r.total_minutes / 480 : 0;
    const s = r.starts_on > from ? r.starts_on : from;
    const e = r.ends_on < to ? r.ends_on : to;
    if (s > e) return 0;
    return Math.round((Date.parse(e) - Date.parse(s)) / 86400000) + 1;
  };
  const monthEnd = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return `${m}-${String(new Date(Date.UTC(y!, mo!, 0)).getUTCDate()).padStart(2, "0")}`;
  };

  for (const r of data.reqs) {
    const counted = r.status === "SUBMITTED" || r.status === "APPROVED";
    const yearly = r.yearly_entitlement;
    if (yearly && !opts.showYearly) continue;
    const period: "year" | "month" = yearly ? "year" : "month";
    const pFrom = yearly ? `${r.starts_on.slice(0, 4)}-01-01` : `${r.starts_on.slice(0, 7)}-01`;
    const pTo = yearly ? `${r.starts_on.slice(0, 4)}-12-31` : monthEnd(r.starts_on.slice(0, 7));
    const before = data.siblings
      .filter((x) => x.id !== r.id && x.employment_id === r.employment_id && x.leave_type_id === r.leave_type_id)
      .filter((x) => x.starts_on < r.starts_on || (x.starts_on === r.starts_on && x.created_at < r.created_at))
      .reduce((sum, x) => sum + daysIn(x, pFrom, pTo), 0);
    const own = daysIn(r, pFrom, pTo);
    const first = before + Math.min(own, 1);
    const last = before + own;
    const nth = own > 1 ? `${fmt(first)}–${fmt(last)}` : fmt(last);
    let quota: number | null = null;
    if (yearly) quota = entitled.get(`${r.employment_id}|${r.leave_type_id}|${r.starts_on.slice(0, 4)}`) ?? 0;
    else if (!r.accrues_from_holidays) {
      const isDayOff = r.auto_approve && !r.requires_reports;
      const q = await opts.monthlyQuotaFor(r.employment_id, r.leave_type_id, r.starts_on.slice(0, 7), r.monthly_quota_days, isDayOff);
      quota = q > 0 ? q : null;
    }
    out.set(r.id, { nth, quota, period, counted });
  }
  return out;
}
