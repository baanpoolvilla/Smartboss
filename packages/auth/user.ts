import { prisma } from "@smartboss/database";

export interface AuthUser {
  id: string;
  orgId: string | null;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: string[];
  permissions: string[];
}

/** โหลด roles (code) + permissions (code) ของ user จาก DB */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
      department: { include: { permissions: { include: { permission: true } } } },
      position: { include: { permissions: { include: { permission: true } } } },
    },
  });

  if (!user || !user.isActive) return null;

  const roles = user.roles.map((ur) => ur.role.code);
  // สิทธิ์รวมจากบทบาท + แผนก + ตำแหน่งที่ user คนนี้สังกัด — คนในแผนก/ตำแหน่ง
  // เดียวกันได้สิทธิ์ที่แผนก/ตำแหน่งกำหนดเพิ่มจากสิทธิ์ตามบทบาทของตัวเอง
  const permissions = Array.from(
    new Set([
      ...user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)),
      ...(user.department?.permissions.map((dp) => dp.permission.code) ?? []),
      ...(user.position?.permissions.map((pp) => pp.permission.code) ?? []),
    ])
  );

  return {
    id: user.id,
    orgId: user.orgId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    roles,
    permissions,
  };
}
