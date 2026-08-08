import "server-only";
import { prisma } from "@smartboss/database";

/** ผู้ใช้ทั้งหมดของบริษัท + role ที่ถืออยู่ */
export async function listOrgUsers(orgId: string) {
  const users = await prisma.user.findMany({
    where: { orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { roles: { include: { role: true } } },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    lineUserId: u.lineUserId,
    isActive: u.isActive,
    lockedUntil: u.lockedUntil,
    createdAt: u.createdAt,
    roleIds: u.roles.map((r) => r.roleId),
    roleNames: u.roles.map((r) => r.role.name),
    /** ถือ role ระบบ (SUPER_ADMIN) — บริษัทถอด/แก้ไม่ได้ */
    hasSystemRole: u.roles.some((r) => r.role.isSystem),
  }));
}

export type OrgUserRow = Awaited<ReturnType<typeof listOrgUsers>>[number];

export async function getOrgUser(orgId: string, userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, orgId },
    include: { roles: { include: { role: true } } },
  });
}

/* ───────────────────── เฉพาะ SUPER_ADMIN ─────────────────────
 * สองฟังก์ชันล่างข้ามขอบเขตบริษัทโดยเจตนา ผู้เรียกต้องเช็ค isSuperAdmin() ก่อนเสมอ
 * แยกชื่อออกมาชัด ๆ เพื่อให้เห็นตอนอ่านโค้ดว่าตรงไหนข้ามบริษัท
 */

/** ผู้ใช้ทุกบริษัท (หรือกรองเฉพาะบริษัทเดียวถ้าส่ง orgId มา) */
export async function listUsersAcrossOrgs(orgId?: string) {
  const users = await prisma.user.findMany({
    where: orgId ? { orgId } : {},
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      roles: { include: { role: true } },
      organization: { select: { id: true, name: true } },
    },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    lineUserId: u.lineUserId,
    isActive: u.isActive,
    lockedUntil: u.lockedUntil,
    createdAt: u.createdAt,
    roleIds: u.roles.map((r) => r.roleId),
    roleNames: u.roles.map((r) => r.role.name),
    hasSystemRole: u.roles.some((r) => r.role.isSystem),
    orgId: u.orgId,
    /** null = ผู้ใช้ระดับแพลตฟอร์ม ยังไม่สังกัดบริษัทไหน */
    orgName: u.organization?.name ?? null,
  }));
}

export type AnyOrgUserRow = Awaited<ReturnType<typeof listUsersAcrossOrgs>>[number];

/** ผู้ใช้รายคนโดยไม่จำกัดบริษัท */
export async function getUserAnyOrg(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: true } },
      organization: { select: { id: true, name: true } },
    },
  });
}

export async function countOrgUsers(orgId: string) {
  const [total, active] = await Promise.all([
    prisma.user.count({ where: { orgId } }),
    prisma.user.count({ where: { orgId, isActive: true } }),
  ]);
  return { total, active };
}
