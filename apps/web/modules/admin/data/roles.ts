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
  };
}
