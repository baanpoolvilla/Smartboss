import "server-only";
import { prisma } from "@smartboss/database";
import type { Session } from "@smartboss/auth";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { readSettings, withSalaryTenant } from "./db";
import { headers } from "next/headers";
import { ipAllowed, loadSecuritySettings } from "@/lib/security-settings";
import { twoFactorMissing } from "@/lib/security-guards";

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
  /** แก้ข้อมูลเงินเดือนของตัวเองได้ (CEO เสมอ · คนที่ CEO เลือกเมื่อบริษัทเปิดสวิตช์) */
  canEditOwn: boolean;
  /** มาจากไหน — แสดงในหน้าตั้งค่า/บันทึกประวัติ */
  via: "ceo" | "editor" | "super_admin" | null;
  /**
   * มีสิทธิ์จัดการเงินเดือน แต่ถูกกันไว้ชั่วคราวตามที่บริษัทตั้ง (หลังบ้าน › ความปลอดภัย) — สิทธิ์ทุกตัวข้างบนเป็น false
   * ip = เปิดจากที่ที่ไม่อยู่ในรายการ IP · two_factor = บทบาทถูกบังคับยืนยันตัวตน 2 ชั้นแต่ยังไม่ได้เปิด
   * บริษัทที่ไม่ได้ตั้งอะไร = ไม่มีทางเป็นค่าอื่นนอกจาก undefined (พฤติกรรมเดิม)
   */
  blocked?: "ip" | "two_factor";
}

const NONE: SalaryAccess = { canEdit: false, canApprove: false, canManageAccess: false, canEditOwn: false, isCeo: false, isSuperAdmin: false, via: null };

export function accessFrom(session: Pick<Session, "userId" | "roles">, settings: { editorUserIds: string[]; superAdminAccess: boolean; editorsEditOwn?: boolean }): SalaryAccess {
  const isCeo = session.roles.includes("CEO");
  const isSuperAdmin = session.roles.includes("SUPER_ADMIN");
  const superOk = isSuperAdmin && settings.superAdminAccess;
  if (isCeo) return { canEdit: true, canApprove: true, canManageAccess: true, canEditOwn: true, isCeo, isSuperAdmin, via: "ceo" };
  if (superOk) return { canEdit: true, canApprove: true, canManageAccess: true, canEditOwn: !!settings.editorsEditOwn, isCeo, isSuperAdmin, via: "super_admin" };
  if (settings.editorUserIds.includes(session.userId)) return { canEdit: true, canApprove: false, canManageAccess: false, canEditOwn: !!settings.editorsEditOwn, isCeo, isSuperAdmin, via: "editor" };
  return { ...NONE, isCeo, isSuperAdmin };
}

/**
 * สิทธิ์ของคนที่กำลังใช้งานอยู่ (คำขอนี้) — สิทธิ์ตามบทบาท/รายชื่อ แล้วผ่านด่านที่บริษัทเปิดไว้อีกชั้น
 * ที่เดียวที่ทุกหน้า/ทุก action/ไฟล์ส่งออกของเงินเดือนเรียก จึงกันครบโดยไม่ต้องไล่ใส่ทีละจุด
 */
export async function salaryAccess(session: Pick<Session, "userId" | "roles" | "orgId">): Promise<SalaryAccess> {
  const base = await salaryAccessBase(session);
  if (!session.orgId || !(base.canEdit || base.canApprove || base.canManageAccess)) return base;
  const security = await loadSecuritySettings(session.orgId).catch(() => null);
  if (!security) return base;
  const locked = (blocked: "ip" | "two_factor"): SalaryAccess => ({ ...NONE, isCeo: base.isCeo, isSuperAdmin: base.isSuperAdmin, blocked });
  if (security.salaryAllowedIps.length > 0) {
    let ip: string | null = null;
    let inRequest = true;
    try {
      const h = await headers();
      ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
    } catch {
      inRequest = false; // เรียกนอกคำขอ (งานเบื้องหลัง) — ไม่มี IP ให้ตัดสิน
    }
    if (inRequest && !ipAllowed(security.salaryAllowedIps, ip)) return locked("ip");
  }
  if (await twoFactorMissing(session.userId, session.roles, security)) return locked("two_factor");
  return base;
}

/** สิทธิ์ตามบทบาท/รายชื่อล้วน ๆ ไม่ดูว่าเปิดจากที่ไหน — ใช้กับ "ผู้ใช้คนอื่น" (sync สิทธิ์) ที่ไม่ใช่คนส่งคำขอนี้ */
async function salaryAccessBase(session: Pick<Session, "userId" | "roles" | "orgId">): Promise<SalaryAccess> {
  if (!session.orgId) return NONE;
  const settings = await withSalaryTenant(session.orgId, (tx) => readSettings(tx, session.orgId!)).catch((error: unknown) => {
    // ตารางยังไม่มี (ยังไม่ได้ migrate) = ไม่ให้ใครเห็นนอกจาก CEO — ปลอดภัยไว้ก่อน
    console.error("[salary] read settings failed", error instanceof Error ? error.message : error);
    return { editorUserIds: [] as string[], superAdminAccess: false, editorsEditOwn: false };
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
  return (await salaryAccessBase({ userId, orgId, roles })).canEdit;
}

/**
 * ล็อกไม่ให้แก้ข้อมูลเงินเดือนของตัวเองไหม — CEO แก้ได้เสมอ · คนที่ CEO เลือกแก้ได้เมื่อบริษัทเปิดสวิตช์
 * "คนทำเงินเดือนแก้ของตัวเองได้" (ตั้งค่าเงินเดือน · ผู้ใช้ 8/11/2569 ให้เป็นรายบริษัท) — ปิด = ล็อกแบบเดิม
 */
export function ownSalaryLocked(access: Pick<SalaryAccess, "isCeo" | "canEditOwn">, isOwn: boolean): boolean {
  return isOwn && !access.isCeo && !access.canEditOwn;
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
