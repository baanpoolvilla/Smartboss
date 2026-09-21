import "server-only";
import { prisma } from "@smartboss/database";
import { listUsersAcrossOrgs } from "./users";
import { getSupportOrgId } from "./issue-console-access";
import { configuredSupportOrg, isItDepartmentName } from "../support-org";

/**
 * ทีมรับเรื่องแจ้งบัค = Super Admin ทุกคนที่ยังใช้งานอยู่ + คนในแผนก IT ของบริษัทเรา
 * (ISSUE_SUPPORT_ORG) — ใช้ทั้งเป็นรายชื่อ "ผู้รับผิดชอบ" ในหน้าตั๋ว และเป็นผู้รับแจ้งเตือน
 * ตอนมีตั๋วใหม่/ผู้แจ้งตอบกลับ CEO/ADMIN ไม่อยู่ในรายชื่อนี้ (ดูได้อย่างเดียว ไม่ต้องถูกแจ้งเตือน
 * เมื่อมีหลายบริษัทจะรบกวนเกินไป) ไม่เช็คสิทธิ์ผู้เรียก (ผู้เรียกฝั่งแจ้งเตือนคือพนักงานทั่วไป
 * ที่เพิ่งแจ้งปัญหา) แค่หาว่า "ใครคือทีมรับเรื่อง"
 */
export async function listIssueStaff(): Promise<{ id: string; name: string }[]> {
  const all = await listUsersAcrossOrgs();
  const supportOrgId = await getSupportOrgId();
  // ตั้ง ISSUE_SUPPORT_ORG แล้ว → Super Admin ต้องสังกัดบริษัทเรา (ของบริษัทอื่นไม่ใช่ทีมรับเรื่อง)
  const people = new Map(
    all
      .filter((u) => u.hasSystemRole && u.isActive && (!configuredSupportOrg() || (supportOrgId !== null && u.orgId === supportOrgId)))
      .map((u) => [u.id, u.name])
  );
  if (supportOrgId) {
    const members = await prisma.user.findMany({
      where: { orgId: supportOrgId, isActive: true, departmentId: { not: null } },
      select: { id: true, name: true, department: { select: { name: true } } },
    });
    for (const u of members) if (isItDepartmentName(u.department?.name)) people.set(u.id, u.name);
  }
  return Array.from(people, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "th"));
}
