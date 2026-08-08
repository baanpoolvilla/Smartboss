import { eq } from 'drizzle-orm';
import { SYSTEM_ROLES, uuidv7, type SystemRole } from '@workforce/domain';
import type { Db } from '../client';
import { withTenant } from '../client';
import { people, principalRoleAssignments, principals, roles, tenants } from '../schema';
import { seedSystemRoles } from '../seed/system-roles';

/**
 * เชื่อมตัวตนของ Smartboss เข้ากับ workforce
 *
 * ตัวตนสองระบบใช้ค่าเดียวกันได้เลย ไม่ต้องแปลง:
 *   Smartboss Organization.id → workforce.tenants.id
 *   Smartboss User.id (JWT sub) → workforce.principals.subject
 *
 * ทุกฟังก์ชันเรียกซ้ำได้ (idempotent) เพราะถูกเรียกทั้งตอนสร้างผู้ใช้ใหม่
 * และตอนรัน sync ย้อนหลังกับข้อมูลที่มีอยู่แล้ว
 */

export interface ProvisionTenantInput {
  /** = Organization.id ของ Smartboss */
  tenantId: string;
  /** = Organization.slug */
  code: string;
  name: string;
  timeZone?: string;
  currency?: string;
}

export interface ProvisionTenantResult {
  created: boolean;
  roleIds: Map<SystemRole, string>;
}

export async function provisionTenant(
  db: Db,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  return withTenant(db, input.tenantId, async (tx) => {
    const existing = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId));

    let created = false;
    if (existing.length === 0) {
      await tx.insert(tenants).values({
        id: input.tenantId,
        code: input.code,
        name: input.name,
        defaultTimeZone: input.timeZone ?? 'Asia/Bangkok',
        defaultCurrency: input.currency ?? 'THB',
      });
      created = true;
    }

    // seedSystemRoles เรียกซ้ำได้ — ใช้ role เดิมถ้ามีอยู่แล้ว
    const roleIds = await seedSystemRoles(tx, input.tenantId);
    return { created, roleIds };
  });
}

export interface ProvisionPrincipalInput {
  tenantId: string;
  /** = User.id ของ Smartboss (ค่าเดียวกับ claim `sub` ใน token) */
  subject: string;
  displayName: string;
  email?: string | null;
  /** role ของ workforce ที่ผู้ใช้คนนี้ควรได้ */
  workforceRoles: readonly SystemRole[];
}

export interface ProvisionPrincipalResult {
  principalId: string;
  created: boolean;
  rolesGranted: SystemRole[];
}

export async function provisionPrincipal(
  db: Db,
  input: ProvisionPrincipalInput,
): Promise<ProvisionPrincipalResult> {
  return withTenant(db, input.tenantId, async (tx) => {
    const existing = await tx
      .select({ id: principals.id })
      .from(principals)
      .where(eq(principals.subject, input.subject));

    let principalId = existing[0]?.id;
    let created = false;

    if (principalId === undefined) {
      principalId = uuidv7();
      await tx.insert(principals).values({
        id: principalId,
        tenantId: input.tenantId,
        subject: input.subject,
        displayName: input.displayName,
        email: input.email ?? null,
      });
      created = true;
    } else {
      await tx
        .update(principals)
        .set({ displayName: input.displayName, email: input.email ?? null })
        .where(eq(principals.id, principalId));
    }

    /*
     * ผูก principal (บัญชีล็อกอิน) เข้ากับ person (ทะเบียนพนักงาน) ด้วยอีเมล
     *
     * ทำไมจำเป็น: ผลลงเวลาผูกกับ employment → person ส่วนคะแนนผลงานรวมของระบบ
     * ผูกกับ core.users.id ถ้าไม่มีเส้นนี้ การมาสาย/ขาดงานจะแปลงกลับไปเป็น
     * "คนคนไหนใน Smartboss" ไม่ได้ แล้วหน้าสรุปของผู้บริหารจะขาดฝั่งลงเวลาไป
     *
     * จับคู่ด้วยอีเมลเพราะเป็นค่าเดียวที่ทั้งสองฝั่งมีและไม่ซ้ำ — คนที่ยังไม่ถูก
     * ขึ้นทะเบียนเป็นพนักงาน (เช่นแอดมินระบบ) จะไม่มีคู่ ซึ่งถูกต้องแล้ว
     */
    if (input.email) {
      const match = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.email, input.email));
      const personId = match[0]?.id ?? null;
      if (personId !== null) {
        await tx.update(principals).set({ personId }).where(eq(principals.id, principalId));
      }
    }

    // หา role id ของ tenant นี้ (ต้อง seed มาก่อนแล้วจาก provisionTenant)
    const roleRows = await tx.select({ id: roles.id, code: roles.code }).from(roles);
    const roleIdByCode = new Map(roleRows.map((row) => [row.code.toUpperCase(), row.id]));

    const currentAssignments = await tx
      .select({ roleId: principalRoleAssignments.roleId })
      .from(principalRoleAssignments)
      .where(eq(principalRoleAssignments.principalId, principalId));
    const alreadyAssigned = new Set(currentAssignments.map((row) => row.roleId));

    const rolesGranted: SystemRole[] = [];
    for (const code of input.workforceRoles) {
      const roleId = roleIdByCode.get(code);
      if (roleId === undefined || alreadyAssigned.has(roleId)) continue;
      await tx.insert(principalRoleAssignments).values({
        id: uuidv7(),
        tenantId: input.tenantId,
        principalId,
        roleId,
        reason: 'synced from Smartboss',
      });
      rolesGranted.push(code);
    }

    return { principalId, created, rolesGranted };
  });
}

/* ══════════════════════════════════════════════════════════════════
   แปลงสิทธิ์ของ Smartboss → role ของ workforce
   ══════════════════════════════════════════════════════════════════ */

/** สิทธิ์ฝั่ง Smartboss ที่เกี่ยวข้อง (ตรงกับ modules/hr/permissions.ts และ modules/admin) */
export const SMARTBOSS_PERMISSION = {
  adminAccess: 'core.admin',
  employeeView: 'hr.employee.view',
  employeeManage: 'hr.employee.manage',
  salaryView: 'hr.salary.view',
  salaryManage: 'hr.salary.manage',
  payrollView: 'hr.payroll.view',
  payrollManage: 'hr.payroll.manage',
  payrollApprove: 'hr.payroll.approve',
  settingManage: 'hr.setting.manage',
} as const;

export interface RoleMappingInput {
  /** role code ของ Smartboss เช่น SUPER_ADMIN, HR_OFFICER */
  roles: readonly string[];
  /** permission code ที่ผู้ใช้มี */
  permissions: readonly string[];
}

/**
 * เลือก role ของ workforce จากสิทธิ์ที่ผู้ใช้มีใน Smartboss
 *
 * กฎแยกหน้าที่ (HANDOFF §4): PAYROLL_PREPARER กับ PAYROLL_APPROVER ต้องไม่ใช่คนเดียวกัน
 * คนที่อนุมัติได้จะได้ APPROVER อย่างเดียว ไม่ได้ PREPARER ติดมาด้วย
 * — บังคับที่ระดับสิทธิ์ ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
 */
export function mapSmartbossRoles(input: RoleMappingInput): SystemRole[] {
  const perms = new Set(input.permissions);
  const roleCodes = new Set(input.roles.map((code) => code.toUpperCase()));
  const granted = new Set<SystemRole>();

  const has = (permission: string): boolean => perms.has(permission);

  // ผู้ดูแลระบบ/ผู้ดูแลบริษัท → ผู้ดูแลองค์กรของ workforce
  if (roleCodes.has('SUPER_ADMIN') || roleCodes.has('ADMIN')) {
    granted.add('TENANT_ADMIN');
  }

  if (roleCodes.has('MANAGER')) granted.add('SUPERVISOR');

  if (has(SMARTBOSS_PERMISSION.employeeManage) || roleCodes.has('HR_OFFICER')) {
    granted.add('HR_OFFICER');
  }

  // ── เงินเดือน: อนุมัติได้ = APPROVER เท่านั้น ห้ามได้ PREPARER ด้วย ──
  if (has(SMARTBOSS_PERMISSION.payrollApprove)) {
    granted.add('PAYROLL_APPROVER');
  } else if (
    has(SMARTBOSS_PERMISSION.payrollManage) ||
    has(SMARTBOSS_PERMISSION.salaryManage)
  ) {
    granted.add('PAYROLL_PREPARER');
  }

  if (has(SMARTBOSS_PERMISSION.settingManage)) {
    granted.add('HR_OFFICER');
    // หน้า /hr/devices ของ Smartboss เปิดให้คนที่มี hr.setting.manage
    // แต่สิทธิ์เครื่องสแกนอยู่ที่ DEVICE_TECHNICIAN — ถ้าไม่ให้ด้วย
    // ปุ่มบนหน้าจอจะกดแล้ว 403 ทุกครั้ง (ลงทะเบียนเครื่อง/ออกโทเคน/ผูกลายนิ้วมือ)
    granted.add('DEVICE_TECHNICIAN');
  }

  // ทุกคนที่เข้าถึงระบบได้ อย่างน้อยต้องเป็นพนักงาน (ดูสลิป/ลงเวลาของตัวเอง)
  granted.add('EMPLOYEE');

  // เรียงตามลำดับใน SYSTEM_ROLES เพื่อให้ผลลัพธ์คงที่ เทียบใน test ได้
  return SYSTEM_ROLES.filter((role) => granted.has(role));
}
