import "server-only";
import { prisma } from "@smartboss/database";

export { listPermissionCatalog, type PermissionGroup } from "./permission-catalog";

/**
 * บทบาทที่บริษัทเห็น = role ของบริษัทเอง + role ระบบ (org_id = null)
 * role ระบบแก้ไม่ได้ — คุมด้วย isSystem ทั้งฝั่ง UI และฝั่ง action
 */
export async function listRoles(orgId: string) {
  const roles = await prisma.role.findMany({
    where: { OR: [{ orgId }, { orgId: null }] },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: {
      permissions: { select: { permissionId: true } },
      department: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
  });

  return roles.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    userCount: r._count.users,
    permissionCount: r.permissions.length,
    departmentId: r.departmentId,
    departmentName: r.department?.name ?? null,
  }));
}

export type RoleRow = Awaited<ReturnType<typeof listRoles>>[number];

export async function getRole(orgId: string, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, OR: [{ orgId }, { orgId: null }] },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!role) return null;
  return {
    id: role.id,
    orgId: role.orgId,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionIds: role.permissions.map((p) => p.permissionId),
    departmentId: role.departmentId,
  };
}

/**
 * คนที่ถือ role นี้อยู่ — ใช้ในหน้าแก้ไข role เป็นทางลัดตั้ง/ถอดหัวหน้าแผนก
 * ที่ role นี้ผูกไว้ (ดู Role.departmentId) โดยไม่ต้องสลับไปหน้าแผนกเอง
 */
export async function listRoleHolders(orgId: string, roleId: string) {
  const holders = await prisma.user.findMany({
    where: { orgId, roles: { some: { roleId } } },
    select: { id: true, name: true, email: true, headOf: { select: { departmentId: true } } },
    orderBy: { name: "asc" },
  });
  return holders.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    headOfDepartmentIds: u.headOf.map((h) => h.departmentId),
  }));
}
