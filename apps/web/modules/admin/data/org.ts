import "server-only";
import { prisma } from "@smartboss/database";
import { moduleRegistry } from "@/module-registry";

export async function getOrganization(orgId: string) {
  return prisma.organization.findUnique({ where: { id: orgId } });
}

/**
 * โมดูลในแคตตาล็อกทั้งหมด + สถานะของบริษัทนี้
 * "ยังไม่พร้อมใช้" = มีในแคตตาล็อกแต่ยังไม่มีโค้ดใน registry (โมดูลอนาคต)
 */
export async function listOrgModules(orgId: string) {
  const [modules, orgModules] = await Promise.all([
    prisma.module.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.orgModule.findMany({ where: { orgId } }),
  ]);

  const enabled = new Map(orgModules.map((om) => [om.moduleId, om.isEnabled]));
  const installed = new Set(moduleRegistry.map((m) => m.id));

  return modules
    .filter((m) => !moduleRegistry.some((r) => r.id === m.code && r.alwaysOn))
    .map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      color: m.color,
      /** มีโค้ดอยู่ในระบบแล้วหรือยัง */
      installed: installed.has(m.code),
      enabled: enabled.get(m.id) ?? false,
    }));
}

export type OrgModuleRow = Awaited<ReturnType<typeof listOrgModules>>[number];

export async function listAuditLogs(orgId: string, limit = 100) {
  // audit_logs ไม่มี org_id → กรองผ่าน user ที่สังกัดบริษัทนี้
  const users = await prisma.user.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const logs = await prisma.auditLog.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return logs.map((l) => ({
    id: l.id,
    userName: l.userId ? (nameById.get(l.userId) ?? "-") : "ระบบ",
    module: l.module,
    action: l.action,
    targetId: l.targetId,
    ip: l.ip,
    createdAt: l.createdAt,
  }));
}
