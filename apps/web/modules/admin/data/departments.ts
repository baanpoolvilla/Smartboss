import "server-only";
import { prisma } from "@smartboss/database";

/**
 * แผนกของบริษัท — ของกลาง (core.departments) ใช้ร่วมกันได้ทุกโมดูล
 * ไม่มี "แผนกระดับระบบ" เหมือน Role (orgId = null) — ทุกแผนกเป็นของบริษัทเดียวเสมอ
 */
export async function listDepartments(orgId: string) {
  const departments = await prisma.department.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    include: {
      permissions: { select: { permissionId: true } },
      _count: { select: { users: true } },
    },
  });

  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    userCount: d._count.users,
    permissionCount: d.permissions.length,
  }));
}

export type DepartmentRow = Awaited<ReturnType<typeof listDepartments>>[number];

export async function getDepartment(orgId: string, departmentId: string) {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!department) return null;
  return {
    id: department.id,
    orgId: department.orgId,
    name: department.name,
    description: department.description,
    permissionIds: department.permissions.map((p) => p.permissionId),
  };
}
