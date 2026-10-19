import "server-only";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";

export interface OwnNameParts {
  personId: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  /** รูปแบบชื่อของบริษัท (NICK_FIRST | FIRST_NICK | FULL_NAME) */
  format: string;
}

/**
 * ชื่อสามช่องของคนที่ล็อกอินอยู่จากทะเบียนพนักงาน — ไว้ให้หน้า "บัญชีของฉัน" แก้เป็นช่อง ๆ (ผู้ใช้ขอ 19/10/2569)
 * หาแบบเดียวกับโมดูลคนงาน: principal ที่ผูกกับบัญชีก่อน ไม่มีค่อยเทียบอีเมล · ไม่มีทะเบียน = null (หน้าใช้ช่องเดียวเหมือนเดิม)
 */
export async function loadOwnNameParts(orgId: string, userId: string, email: string | null): Promise<OwnNameParts | null> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRawUnsafe<{ person_id: string; first_name: string; last_name: string; preferred_name: string; format: string | null }[]>(
      `SELECT pe.id::text AS person_id, pe.first_name, pe.last_name, pe.preferred_name, c.display_name_format AS format
         FROM workforce.people pe
         JOIN workforce.employments e ON e.person_id = pe.id AND e.status <> 'TERMINATED'
         LEFT JOIN workforce.companies c ON c.id = e.company_id
         LEFT JOIN workforce.principals p ON p.person_id = pe.id AND p.subject = $1
        WHERE p.subject = $1 OR ($2 <> '' AND lower(pe.email) = lower($2))
        ORDER BY (p.subject IS NOT NULL) DESC, e.hired_on DESC
        LIMIT 1`,
      userId,
      email ?? "",
    ),
  ).catch(() => []);
  const r = rows[0];
  if (!r) return null;
  return { personId: r.person_id, firstName: r.first_name, lastName: r.last_name, preferredName: r.preferred_name ?? "", format: r.format ?? "FULL_NAME" };
}
