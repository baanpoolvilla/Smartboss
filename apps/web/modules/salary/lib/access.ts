import "server-only";
import { prisma } from "@smartboss/database";
import type { Session } from "@smartboss/auth";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { readSettings, withSalaryTenant } from "./db";

/**
 * ใครเห็น/แก้ข้อมูลเงินเดือนของคนอื่นได้ — ที่ตัดสินที่เดียวของทั้งระบบ
 * (โมดูลเงินเดือน · แท็บฐานเงินเดือน/ค่าคอมในระบบบุคคล · ยอดเงิน OT ในเบิกจ่าย & OT · sync สิทธิ์ไป workforce)
 *
 * ผู้ใช้กำหนด 22/10/2569:
 *   - "มีแค่ CEO และหัวหน้า HR เท่านั้นที่กรอกข้อมูลเงินเดือนได้" → CEO (บทบาท CEO) + รายชื่อที่ CEO เลือกในตั้งค่า
 *     (ไม่ผูกกับบทบาท — HR คนอื่นและผู้ดูแลบริษัท/IT ไม่เห็นเงินเดือนของใครเลย)
 *   - "ขอผู้ดูแลระบบสูงสุดเห็นก่อน ถ้าพร้อมใช้จริงจะไม่ให้เห็น" → SUPER_ADMIN ผ่านเมื่อสวิตช์ superAdminAccess เปิด
 *   - CEO อนุมัติรอบ · เพิ่ม/เอาคนออกจากรายชื่อได้เฉพาะ CEO
 * ทุกคนเห็นสลิปของตัวเองเสมอ (ตรวจที่หน้าสลิป ไม่ใช่ที่นี่)
 *
 * บทบาทอ่านจาก DB ทุก request (session.roles) — ถอด CEO/เอาชื่อออกจากรายชื่อแล้วมีผลทันที
 */
export interface SalaryAccess {
  /** เห็นและแก้ข้อมูลเงินเดือนของทุกคน */
  canEdit: boolean;
  /** อนุมัติรอบเงินเดือน */
  canApprove: boolean;
  /** เปลี่ยนรายชื่อคนที่แก้เงินเดือนได้ + สวิตช์ SUPER_ADMIN */
  canManageAccess: boolean;
  isCeo: boolean;
  isSuperAdmin: boolean;
  /** มาจากไหน — แสดงในหน้าตั้งค่า/บันทึกประวัติ */
  via: "ceo" | "editor" | "super_admin" | null;
}

const NONE: SalaryAccess = { canEdit: false, canApprove: false, canManageAccess: false, isCeo: false, isSuperAdmin: false, via: null };

export function accessFrom(session: Pick<Session, "userId" | "roles">, settings: { editorUserIds: string[]; superAdminAccess: boolean }): SalaryAccess {
  const isCeo = session.roles.includes("CEO");
  const isSuperAdmin = session.roles.includes("SUPER_ADMIN");
  const superOk = isSuperAdmin && settings.superAdminAccess;
  if (isCeo) return { canEdit: true, canApprove: true, canManageAccess: true, isCeo, isSuperAdmin, via: "ceo" };
  if (superOk) return { canEdit: true, canApprove: true, canManageAccess: true, isCeo, isSuperAdmin, via: "super_admin" };
  if (settings.editorUserIds.includes(session.userId)) return { canEdit: true, canApprove: false, canManageAccess: false, isCeo, isSuperAdmin, via: "editor" };
  return { ...NONE, isCeo, isSuperAdmin };
}

export async function salaryAccess(session: Pick<Session, "userId" | "roles" | "orgId">): Promise<SalaryAccess> {
  if (!session.orgId) return NONE;
  const settings = await withSalaryTenant(session.orgId, (tx) => readSettings(tx, session.orgId!)).catch((error: unknown) => {
    // ตารางยังไม่มี (ยังไม่ได้ migrate) = ไม่ให้ใครเห็นนอกจาก CEO — ปลอดภัยไว้ก่อน
    console.error("[salary] read settings failed", error instanceof Error ? error.message : error);
    return { editorUserIds: [] as string[], superAdminAccess: false };
  });
  return accessFrom(session, settings);
}

/**
 * ผู้ใช้คนนี้ (ไม่ใช่คนที่ล็อกอินอยู่) แก้เงินเดือนได้ไหม — ใช้ตอน sync สิทธิ์ไประบบบุคคล (workforce)
 * ให้ API ของระบบบุคคลเปิดฐานเงินเดือนให้เฉพาะคนกลุ่มนี้
 */
export async function userCanEditSalary(orgId: string, userId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId, isActive: true },
    select: { roles: { select: { role: { select: { code: true } } } } },
  });
  if (!user) return false;
  const roles = user.roles.map((r) => r.role.code);
  return (await salaryAccess({ userId, orgId, roles })).canEdit;
}

/** พนักงานคนนี้ (employment) คือบัญชีผู้ใช้ userId เองไหม — ใช้กันคนทำเงินเดือนแก้ของตัวเอง */
export async function isOwnEmployment(orgId: string, userId: string, employmentId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(employmentId)) return false;
  // ผูกผ่าน principal หรือยังไม่ผูกแต่อีเมลในทะเบียนตรงกับบัญชีนี้ (คนเพิ่งนำเข้า) — ถือเป็นของตัวเองทั้งคู่
  const email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? "";
  const rows = await withWorkforceTenant(orgId, (wtx) =>
    wtx.$queryRawUnsafe<{ own: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM workforce.employments e JOIN workforce.people pe ON pe.id = e.person_id
                       WHERE e.id = $1::uuid
                         AND (EXISTS (SELECT 1 FROM workforce.principals p WHERE p.person_id = e.person_id AND p.subject = $2)
                              OR ($3 <> '' AND lower(pe.email) = lower($3)))) AS own`,
      employmentId,
      userId,
      email,
    ),
  );
  return rows[0]?.own === true;
}
