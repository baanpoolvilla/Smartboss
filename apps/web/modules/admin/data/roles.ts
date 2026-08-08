import "server-only";
import { prisma } from "@smartboss/database";

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

/** สิทธิ์ทั้งหมดในแคตตาล็อก จัดกลุ่มตามโมดูล (moduleId = null → กลุ่ม core) */
export async function listPermissionCatalog() {
  const perms = await prisma.permission.findMany({
    orderBy: { code: "asc" },
    include: { module: { select: { code: true, name: true, color: true } } },
  });

  const groups = new Map<
    string,
    { key: string; name: string; color: string; items: { id: string; code: string }[] }
  >();

  for (const p of perms) {
    const key = p.module?.code ?? "core";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: p.module?.name ?? "ระบบหลัก (หลังบ้าน)",
        color: p.module?.color ?? "#1B2537",
        items: [],
      });
    }
    groups.get(key)!.items.push({ id: p.id, code: p.code });
  }

  // ระบบหลักขึ้นก่อนเสมอ ที่เหลือเรียงตามชื่อ
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === "core") return -1;
    if (b.key === "core") return 1;
    return a.name.localeCompare(b.name);
  });
}

export type PermissionGroup = Awaited<
  ReturnType<typeof listPermissionCatalog>
>[number];
