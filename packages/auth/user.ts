import { prisma } from "@smartboss/database";

export interface AuthUser {
  id: string;
  orgId: string | null;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: string[];
  permissions: string[];
  /**
   * แผนกที่ user คนนี้เป็นหัวหน้าอยู่ — ใช้คุม data scope (เห็น/แก้ข้อมูลของทั้ง
   * แผนก) เท่านั้น ไม่ใช่สิทธิ์การใช้งานเมนู/ฟีเจอร์ (นั่นมาจาก Role อย่างเดียว)
   * ⚠ ห้ามใส่ลง JWT และห้ามส่งออกไปที่ client ตรงๆ — ต้อง derive ใหม่ทุก
   * request ฝั่ง server เพื่อให้การเพิ่ม/ถอดหัวหน้าแผนกมีผลทันที ไม่ต้องรอ
   * token หมดอายุ/refresh (ดู PLAN_role_only_department_heads_2.md Phase 2.1)
   */
  headOfDepartmentIds: string[];
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
      headOf: { select: { departmentId: true } },
    },
  });

  if (!user || !user.isActive) return null;

  const roles = user.roles.map((ur) => ur.role.code);
  // สิทธิ์การใช้งานระบบมาจาก Role อย่างเดียว — แผนก/ตำแหน่งไม่มีสิทธิ์ของตัวเอง
  // อีกต่อไป (ดู DepartmentHead ที่คุม data scope แยกต่างหาก แทน)
  const permissions = Array.from(
    new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)))
  );

  return {
    id: user.id,
    orgId: user.orgId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    roles,
    permissions,
    headOfDepartmentIds: user.headOf.map((h) => h.departmentId),
  };
}
