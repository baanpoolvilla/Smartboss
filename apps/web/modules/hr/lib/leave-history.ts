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
              lr.employment_id::text, COALESCE(NULLIF(pe.preferred_name, ''), pe.first_name, '') AS owner_name,
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
