import "server-only";
import { prisma } from "@smartboss/database";

/**
 * รายชื่อบริษัททั้งหมดในแพลตฟอร์ม — ใช้เฉพาะหน้าจอของ SUPER_ADMIN
 *
 * ⚠ ฟังก์ชันนี้ข้ามขอบเขตบริษัทโดยเจตนา ผู้เรียกต้องเช็ค isSuperAdmin() เองก่อนเสมอ
 * (โมดูลอื่นห้ามเรียก — ข้อมูลรายบริษัทต้องผ่าน helper ที่รับ orgId เท่านั้น)
 */
export async function listAllOrganizations() {
  const orgs = await prisma.organization.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      planCode: true,
      _count: { select: { users: true } },
    },
  });

  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    isActive: o.isActive,
    planCode: o.planCode,
    userCount: o._count.users,
  }));
}

export type OrganizationRow = Awaited<ReturnType<typeof listAllOrganizations>>[number];

/** ตรวจว่า orgId ที่ส่งมามีจริง — ใช้ก่อนเขียนข้อมูลข้ามบริษัท */
export async function organizationExists(orgId: string): Promise<boolean> {
  const count = await prisma.organization.count({ where: { id: orgId } });
  return count > 0;
}
