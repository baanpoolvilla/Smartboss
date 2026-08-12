import "server-only";
import { prisma } from "@smartboss/database";

/**
 * ตำแหน่งของบริษัท — ของกลาง (core.positions) เหมือน departments.ts ทุกกระเบียด
 * แทนที่ "ตำแหน่ง" ที่เคยเป็นข้อความอิสระต่อคนในแต่ละโมดูล
 */
export async function listPositions(orgId: string) {
  const positions = await prisma.position.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    include: {
      permissions: { select: { permissionId: true } },
      _count: { select: { users: true } },
    },
  });

  return positions.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    userCount: p._count.users,
    permissionCount: p.permissions.length,
  }));
}

export type PositionRow = Awaited<ReturnType<typeof listPositions>>[number];

export async function getPosition(orgId: string, positionId: string) {
  const position = await prisma.position.findFirst({
    where: { id: positionId, orgId },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!position) return null;
  return {
    id: position.id,
    orgId: position.orgId,
    name: position.name,
    description: position.description,
    permissionIds: position.permissions.map((p) => p.permissionId),
  };
}
