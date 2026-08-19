import { eq } from 'drizzle-orm';
import { uuidv7, type SystemRole } from '@workforce/domain';
import type { Db } from '../client';
import { withTenant } from '../client';
import { companies, people, principalRoleAssignments, principals, roles, tenants } from '../schema';
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
  /** รหัสนิติบุคคลตั้งต้น — ปกติใช้ Organization.code (เช่น SM0001) ไม่ใช่ slug */
  companyCode?: string;
  name: string;
  timeZone?: string;
  currency?: string;
}

export interface ProvisionTenantResult {
  created: boolean;
  roleIds: Map<SystemRole, string>;
  /** id ของนิติบุคคลตั้งต้น — มีเสมอหลังเรียกฟังก์ชันนี้ */
  companyId: string;
  companyCreated: boolean;
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

    /*
     * นิติบุคคลตั้งต้น — 1 บริษัทใน Smartboss = 1 company ที่นี่
     *
     * workforce แยก tenant (ลูกค้า) ออกจาก company (นิติบุคคลที่จ้างงาน) เพราะ
     * โครงสร้างรองรับลูกค้าที่มีหลายนิติบุคคล แต่ทุกอย่างที่เหลือ (พนักงาน กะ งวด
     * เครื่องสแกน) ต้องมี company ก่อนถึงจะสร้างได้ ถ้าไม่สร้างให้ตรงนี้ ผู้ใช้ที่เพิ่ง
     * เปิดบริษัทจะเจอฟอร์ม "ตั้งต้นระบบบุคคล" ให้กรอกชื่อบริษัทซ้ำกับที่กรอกไปแล้ว
     * ตอนสมัคร — ข้อมูลชุดเดียวกันแต่ถามสองรอบ และไม่มีอะไรการันตีว่าจะตรงกัน
     *
     * นิติบุคคลที่ 2 ขึ้นไปยังเพิ่มได้ผ่าน POST /companies ตามเดิม
     */
    const existingCompany = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, input.tenantId))
      .limit(1);

    let companyId = existingCompany[0]?.id;
    let companyCreated = false;
    if (companyId === undefined) {
      companyId = uuidv7();
      await tx.insert(companies).values({
        id: companyId,
        tenantId: input.tenantId,
        code: input.companyCode ?? input.code,
        legalName: input.name,
        displayName: input.name,
        timeZone: input.timeZone ?? 'Asia/Bangkok',
        currency: input.currency ?? 'THB',
      });
      companyCreated = true;
    }

    return { created, roleIds, companyId, companyCreated };
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

/*
 * mapSmartbossRoles ย้ายไปอยู่ที่ @workforce/domain แล้ว เพราะฝั่งเว็บของ Smartboss
 * ต้องใช้ตัวเดียวกันตอนสร้าง/แก้ผู้ใช้ แต่ import @workforce/db ไม่ได้ (ลาก drizzle+pg)
 * — re-export ไว้ที่นี่เพื่อไม่ให้ผู้เรียกเดิม (CLI, เทสต์) ต้องแก้
 */
export {
  mapSmartbossRoles,
  SMARTBOSS_PERMISSION,
  type RoleMappingInput,
} from '@workforce/domain';
