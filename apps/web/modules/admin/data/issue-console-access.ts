import "server-only";
import { redirect } from "next/navigation";
import { requireOrg } from "@smartboss/auth";
import { SUPER_ADMIN_ROLE } from "@smartboss/auth/permissions";
import { prisma } from "@smartboss/database";
import {
  SUPPORT_STAFF_ROLES,
  configuredSupportOrg,
  isSupportStaff,
  type IssueConsoleAccess,
} from "../support-org";

/**
 * ใครเข้าคอนโซลแจ้งบัค (/admin/issue-reports) ได้ และทำอะไรได้:
 *   - Super Admin → full (ทุกบริษัท ทำได้ทุกอย่าง)
 *   - CEO/ADMIN ของบริษัทเรา (ISSUE_SUPPORT_ORG) → home: เห็นทุกบริษัท แต่
 *     แก้/ตอบ/รับเรื่อง/ลบได้เฉพาะตั๋วของบริษัทเราเอง
 *   - อื่น ๆ → null
 * ต้องเรียกจาก server เท่านั้น — ตัดสินจาก session ไม่ใช่ค่าที่ client ส่งมา
 */
export async function getIssueConsoleAccess(session: { orgId: string | null; roles: string[] }): Promise<IssueConsoleAccess | null> {
  if (session.roles.includes(SUPER_ADMIN_ROLE)) return { kind: "full" };
  if (!session.orgId || !configuredSupportOrg()) return null;
  if (!session.roles.some((r) => (SUPPORT_STAFF_ROLES as readonly string[]).includes(r))) return null;
  const org = await prisma.organization.findUnique({ where: { id: session.orgId }, select: { code: true, slug: true } });
  return isSupportStaff(session.roles, org) ? { kind: "home", orgId: session.orgId } : null;
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
