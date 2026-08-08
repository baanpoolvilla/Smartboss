import { SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES, uuidv7, type SystemRole } from '@workforce/domain';
import type { Tx } from '../client';
import { rolePermissions, roles } from '../schema';

const ROLE_NAMES: Record<SystemRole, string> = {
  EMPLOYEE: 'พนักงาน',
  SUPERVISOR: 'หัวหน้างาน',
  HR_OFFICER: 'เจ้าหน้าที่บุคคล',
  PAYROLL_PREPARER: 'ผู้จัดทำเงินเดือน',
  PAYROLL_APPROVER: 'ผู้อนุมัติเงินเดือน',
  FINANCE_OFFICER: 'เจ้าหน้าที่การเงิน',
  DEVICE_TECHNICIAN: 'ช่างเทคนิคเครื่องสแกน',
  AUDITOR: 'ผู้ตรวจสอบ',
  TENANT_ADMIN: 'ผู้ดูแลองค์กร',
  SUPPORT_OPERATOR: 'เจ้าหน้าที่สนับสนุน (ชั่วคราว)',
};

/**
 * สร้าง role ตั้งต้นของ tenant พร้อม permission ตาม spec §5
 *
 * ต้องรันภายใน transaction ที่ตั้ง tenant GUC แล้ว (withTenant)
 * เรียกซ้ำได้ — ใช้ role ที่มีอยู่แล้วแทนการสร้างใหม่
 */
export async function seedSystemRoles(
  tx: Tx,
  tenantId: string,
  actorId: string | null = null,
): Promise<Map<SystemRole, string>> {
  const existing = await tx.select({ id: roles.id, code: roles.code }).from(roles);
  const byCode = new Map(existing.map((row) => [row.code.toUpperCase(), row.id]));
  const result = new Map<SystemRole, string>();

  for (const code of SYSTEM_ROLES) {
    let roleId = byCode.get(code);

    if (roleId === undefined) {
      roleId = uuidv7();
      await tx.insert(roles).values({
        id: roleId,
        tenantId,
        code,
        name: ROLE_NAMES[code],
        isSystem: true,
        description: `system role: ${code}`,
        createdBy: actorId,
        updatedBy: actorId,
      });
    }

    const permissions = SYSTEM_ROLE_PERMISSIONS[code];
    if (permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(
          permissions.map((permission) => ({
            tenantId,
            roleId: roleId as string,
            permission,
            createdBy: actorId,
          })),
        )
        .onConflictDoNothing();
    }

    result.set(code, roleId);
  }

  return result;
}
