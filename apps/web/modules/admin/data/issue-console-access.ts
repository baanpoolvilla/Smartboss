import "server-only";
import { redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { SUPER_ADMIN_ROLE } from "@smartboss/auth/permissions";
import { prisma } from "@smartboss/database";
import {
  SUPPORT_OBSERVER_ROLES,
  configuredSupportOrg,
  isTrustedSuperAdmin,
  supportRoleOf,
  type IssueConsoleAccess,
  type SupportRole,
} from "../support-org";

/**
 * บทบาทของผู้ใช้ในบริษัทเรา (IT = คนแก้, observer = CEO/ADMIN แค่รู้) — null ถ้าไม่เข้าข่าย
 * ไม่ query อะไรเลยถ้ายังไม่ได้ตั้ง ISSUE_SUPPORT_ORG (ผู้ใช้ส่วนใหญ่ผ่านทางนี้)
 */
export async function getSupportRole(user: { userId: string; orgId: string | null; roles: string[] }): Promise<SupportRole | null> {
  if (!user.orgId || !configuredSupportOrg()) return null;
  const org = await prisma.organization.findUnique({ where: { id: user.orgId }, select: { code: true, slug: true } });
  // ไม่ใช่บริษัทเรา → จบเลย ไม่ต้องหาแผนก
  if (!supportRoleOf({ roles: [...SUPPORT_OBSERVER_ROLES] }, org)) return null;
  const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { department: { select: { name: true } } } });
  return supportRoleOf({ roles: user.roles, departmentName: me?.department?.name }, org);
}

/**
 * ใครเข้าคอนโซลแจ้งบัค (/admin/issue-reports) ได้ และทำอะไรได้:
 *   - Super Admin ที่สังกัดบริษัทเรา → full (ทุกบริษัท ทำได้ทุกอย่าง) — Super Admin ของบริษัทอื่นไม่ได้
 *   - แผนก IT ของบริษัทเรา (ISSUE_SUPPORT_ORG) → home/it: เห็นทุกบริษัท แก้ได้เฉพาะตั๋วบริษัทเรา
 *     หรือใบที่ถูกมอบหมายให้
 *   - CEO/ADMIN ของบริษัทเรา → home/observer: เห็นทุกบริษัทแบบดูอย่างเดียว
 *   - อื่น ๆ → null
 * ต้องเรียกจาก server เท่านั้น — ตัดสินจาก session ไม่ใช่ค่าที่ client ส่งมา
 */
export async function getIssueConsoleAccess(session: { userId: string; orgId: string | null; roles: string[] }): Promise<IssueConsoleAccess | null> {
  if (session.roles.includes(SUPER_ADMIN_ROLE)) {
    // Super Admin ต้องสังกัดบริษัทเรา (ถ้าตั้ง ISSUE_SUPPORT_ORG แล้ว) — ของบริษัทอื่นไม่ได้สิทธิ์
    if (!configuredSupportOrg()) return { kind: "full" };
    const org = session.orgId
      ? await prisma.organization.findUnique({ where: { id: session.orgId }, select: { code: true, slug: true } })
      : null;
    return isTrustedSuperAdmin(session.roles, org) ? { kind: "full" } : null;
  }
  const role = await getSupportRole(session);
  return role && session.orgId ? { kind: "home", orgId: session.orgId, role } : null;
}

/** ใช้ในหน้า Server Component — ไม่มีสิทธิ์เด้งกลับหน้าแรก */
export async function requireIssueConsoleAccess() {
  const session = await requireOrg();
  const access = await getIssueConsoleAccess(session);
  if (!access) redirect("/");
  return { session, access };
}

/** id ของบริษัทเรา (ไว้ดึงรายชื่อคนที่มอบหมายงานได้) — null ถ้าไม่ได้ตั้งค่า/หาไม่เจอ */
export async function getSupportOrgId(): Promise<string | null> {
  const configured = configuredSupportOrg();
  if (!configured) return null;
  const orgs = await prisma.organization.findMany({ select: { id: true, code: true, slug: true } });
  return orgs.find((o) => [o.code, o.slug].some((v) => v?.trim().toLowerCase() === configured))?.id ?? null;
}
