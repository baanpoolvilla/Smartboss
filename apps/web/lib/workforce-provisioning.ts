import "server-only";
import { prisma } from "@smartboss/database";
import {
  mapSmartbossRoles,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  uuidv7,
  type SystemRole,
} from "@workforce/domain";

/**
 * เปิด tenant ฝั่ง workforce ให้บริษัทที่เพิ่งสร้าง
 *
 * ทำไมต้องมี: โมดูลบุคคล/ลงเวลา/เงินเดือนเก็บข้อมูลใน schema `workforce`
 * ซึ่งมี tenant ของตัวเอง ถ้าสร้างบริษัทใน `core.organizations` อย่างเดียว
 * ทุกหน้าในโมดูลบุคคลของบริษัทนั้นจะว่างเปล่าโดยไม่มี error ให้เห็น
 * (RLS กรองทิ้งเพราะไม่มี tenant ตรงกัน)
 *
 * เดิมงานนี้ทำด้วย `pnpm wf:sync` ที่เซิร์ฟเวอร์ — ใช้ได้ตอนติดตั้งครั้งแรก
 * แต่ใช้ไม่ได้กับการรับลูกค้ารายใหม่จากหน้าเว็บ เพราะไม่มีใครไปรันให้
 *
 * ── ทำไมไม่ import @workforce/db มาใช้ตรง ๆ ──
 * แพ็กเกจนั้นลาก drizzle + pg เข้ามาทั้งชุด และผูกเว็บกับชั้นข้อมูลของอีกระบบ
 * ที่นี่จึงเขียนด้วย SQL ผ่าน Prisma ตามแบบเดียวกับ report_task/lib/db/workforce-calendar.ts
 * แต่ยัง **อ่านค่าคงที่จาก @workforce/domain** (แพ็กเกจล้วน ไม่มี dependency)
 * เพื่อไม่ให้รายชื่อ role/permission หลุดออกจากแหล่งเดียว
 *
 * tenant id = core.organizations.id เสมอ (ข้อตกลงเดียวกับ wf:sync)
 */

/** client ภายใน transaction ของ Prisma */
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function withWorkforceTenant<T>(
  tenantId: string,
  run: (tx: PrismaTx) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // SET LOCAL ผูกกับ transaction จึงหมดผลเองเมื่อจบ ไม่รั่วไปคำขออื่น
    await tx.$executeRawUnsafe("SET LOCAL ROLE workforce_app");
    await tx.$executeRaw`SELECT set_config('workforce.tenant_id', ${tenantId}, true)`;
    return run(tx);
  });
}

export interface ProvisionResult {
  tenantCreated: boolean;
  rolesCreated: number;
  /** id ของนิติบุคคลตั้งต้น — มีเสมอเมื่อฟังก์ชันทำงานสำเร็จ */
  companyId: string;
  companyCreated: boolean;
}

/**
 * เรียกซ้ำได้ — บริษัทที่มี tenant อยู่แล้วจะไม่ถูกแตะ
 *
 * ไม่ throw ถ้า schema `workforce` ยังไม่ถูกติดตั้ง (ยังไม่ได้รัน wf:migrate)
 * ผู้เรียกตัดสินใจเองว่าจะถือเป็นความล้มเหลวไหม — การสร้างบริษัทไม่ควรพัง
 * เพราะโมดูลบุคคลยังไม่พร้อม
 */
export async function provisionWorkforceTenant(
  orgId: string,
  slug: string,
  name: string,
  actorId: string | null = null,
  /** รหัสนิติบุคคลตั้งต้น — ปกติคือ Organization.code (SM0001) ไม่ใช่ slug */
  companyCode: string = slug
): Promise<ProvisionResult> {
  return withWorkforceTenant(orgId, async (tx) => {
    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM workforce.tenants WHERE id = ${orgId}::uuid
    `;

    let tenantCreated = false;
    if (existing.length === 0) {
      await tx.$executeRaw`
        INSERT INTO workforce.tenants (id, code, name, default_time_zone, default_currency)
        VALUES (${orgId}::uuid, ${slug}, ${name}, 'Asia/Bangkok', 'THB')
      `;
      tenantCreated = true;
    }

    // role ตั้งต้นของ tenant — เทียบด้วย code เพราะ id สุ่มใหม่ทุกครั้ง
    const existingRoles = await tx.$queryRaw<{ id: string; code: string }[]>`
      SELECT id, code FROM workforce.roles WHERE tenant_id = ${orgId}::uuid
    `;
    const byCode = new Map(existingRoles.map((r) => [r.code.toUpperCase(), r.id]));

    let rolesCreated = 0;
    for (const code of SYSTEM_ROLES as readonly SystemRole[]) {
      let roleId = byCode.get(code);

      if (roleId === undefined) {
        roleId = uuidv7();
        await tx.$executeRaw`
          INSERT INTO workforce.roles (id, tenant_id, code, name, is_system, description, created_by, updated_by)
          VALUES (${roleId}::uuid, ${orgId}::uuid, ${code}, ${ROLE_NAMES[code]}, true,
                  ${`system role: ${code}`}, ${actorId}::uuid, ${actorId}::uuid)
        `;
        rolesCreated += 1;
      }

      for (const permission of SYSTEM_ROLE_PERMISSIONS[code]) {
        // ON CONFLICT DO NOTHING ให้เรียกซ้ำได้ และรองรับ permission ที่เพิ่มทีหลัง
        await tx.$executeRaw`
          INSERT INTO workforce.role_permissions (tenant_id, role_id, permission, created_by)
          VALUES (${orgId}::uuid, ${roleId}::uuid, ${permission}, ${actorId}::uuid)
          ON CONFLICT DO NOTHING
        `;
      }
    }

    /*
     * นิติบุคคลตั้งต้น — 1 บริษัทใน Smartboss = 1 company ฝั่ง workforce
     *
     * ทุกอย่างที่เหลือของโมดูลบุคคล (พนักงาน กะ งวด timesheet เครื่องสแกน) ต้องมี
     * company_id เสมอ ถ้าไม่สร้างให้ตรงนี้ หน้า /hr จะเด้งฟอร์มให้ผู้ใช้กรอกชื่อ
     * บริษัทซ้ำกับที่กรอกไปแล้วตอนเปิดบริษัท — ข้อมูลชุดเดียวกันถามสองรอบ
     * และไม่มีอะไรการันตีว่าสองที่จะตรงกัน
     *
     * ใช้ time zone/สกุลเงินจาก tenant เพื่อไม่ให้ค่าตั้งต้นแตกเป็นสองแหล่ง
     */
    const tenantRow = await tx.$queryRaw<
      { default_time_zone: string; default_currency: string }[]
    >`
      SELECT default_time_zone, default_currency
        FROM workforce.tenants WHERE id = ${orgId}::uuid
    `;
    const defaults = tenantRow[0];

    const existingCompany = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM workforce.companies
       WHERE tenant_id = ${orgId}::uuid
       ORDER BY created_at
       LIMIT 1
    `;

    let companyId = existingCompany[0]?.id;
    let companyCreated = false;
    if (companyId === undefined) {
      companyId = uuidv7();
      await tx.$executeRaw`
        INSERT INTO workforce.companies
          (id, tenant_id, code, legal_name, display_name, time_zone, currency, created_by, updated_by)
        VALUES (${companyId}::uuid, ${orgId}::uuid, ${companyCode}, ${name}, ${name},
                ${defaults?.default_time_zone ?? "Asia/Bangkok"},
                ${defaults?.default_currency ?? "THB"},
                ${actorId}::uuid, ${actorId}::uuid)
      `;
      companyCreated = true;
    }

    return { tenantCreated, rolesCreated, companyId, companyCreated };
  });
}

/**
 * ชื่อบริษัทใน Smartboss เปลี่ยน → ชื่อนิติบุคคลฝั่ง workforce ต้องตามไปด้วย
 *
 * เพราะ 1 org = 1 company ชื่อสองที่จึงต้องเป็นค่าเดียวกันเสมอ ไม่งั้นหัวสลิป
 * กับหน้าตั้งค่าบริษัทจะขึ้นคนละชื่อโดยไม่มีใครรู้ว่าอันไหนถูก
 *
 * อัปเดตเฉพาะนิติบุคคลตัวแรก (ตัวที่ระบบสร้างให้) — ตัวที่ 2 ขึ้นไปเป็นของที่
 * ผู้ใช้ตั้งใจเพิ่มเอง ห้ามเขียนทับ
 */
export async function syncWorkforceCompanyName(
  orgId: string,
  name: string,
  actorId: string | null = null
): Promise<void> {
  await withWorkforceTenant(orgId, async (tx) => {
    await tx.$executeRaw`
      UPDATE workforce.companies
         SET legal_name = ${name}, display_name = ${name}, updated_by = ${actorId}::uuid
       WHERE tenant_id = ${orgId}::uuid
         AND id = (SELECT id FROM workforce.companies
                    WHERE tenant_id = ${orgId}::uuid
                    ORDER BY created_at LIMIT 1)
    `;
  });
}

/* ══════════════════════════════════════════════════════════════════
   ผู้ใช้ (principal)
   ══════════════════════════════════════════════════════════════════ */

/** เหตุผลที่ติดไว้กับ role assignment ที่ระบบ sync ให้ — ใช้แยกจากที่มอบด้วยมือ */
const SYNC_REASON = "synced from Smartboss";

export interface PrincipalSyncResult {
  principalCreated: boolean;
  rolesGranted: SystemRole[];
  rolesRevoked: string[];
}

/**
 * สร้าง/ปรับ principal ฝั่ง workforce ให้ตรงกับผู้ใช้ใน Smartboss
 *
 * ทำไมต้องเรียกตอนสร้างผู้ใช้และตอนเปลี่ยนบทบาท: workforce โหลดสิทธิ์จาก
 * ฐานข้อมูลของตัวเองทุก request และ **ไม่ auto-provision** (ตั้งใจ — การให้สิทธิ์
 * ต้องเป็นการกระทำที่ตั้งใจและ audit ได้) ผู้ใช้ที่ไม่มี principal จึงถูกปฏิเสธ 401
 * ทุกหน้าในโมดูลบุคคล เดิมต้องรอให้ใครสักคนไปรัน `pnpm wf:sync` ที่เซิร์ฟเวอร์
 *
 * การถอนสิทธิ์ต้องมีผลจริง: role ที่เคย sync ให้แต่สิทธิ์ปัจจุบันไม่ควรได้แล้วจะถูกลบ
 * ส่วน role ที่มอบด้วยมือฝั่ง workforce (reason อื่น) ไม่ถูกแตะ
 */
export async function syncWorkforcePrincipal(input: {
  orgId: string;
  userId: string;
  displayName: string;
  email: string | null;
  roleCodes: readonly string[];
  permissionCodes: readonly string[];
  actorId?: string | null;
}): Promise<PrincipalSyncResult> {
  const actorId = input.actorId ?? null;
  const wanted = mapSmartbossRoles({
    roles: input.roleCodes,
    permissions: input.permissionCodes,
  });

  return withWorkforceTenant(input.orgId, async (tx) => {
    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM workforce.principals
       WHERE tenant_id = ${input.orgId}::uuid AND subject = ${input.userId}
    `;

    let principalId = existing[0]?.id;
    let principalCreated = false;

    if (principalId === undefined) {
      principalId = uuidv7();
      await tx.$executeRaw`
        INSERT INTO workforce.principals
          (id, tenant_id, subject, display_name, email, created_by, updated_by)
        VALUES (${principalId}::uuid, ${input.orgId}::uuid, ${input.userId},
                ${input.displayName}, ${input.email}, ${actorId}::uuid, ${actorId}::uuid)
      `;
      principalCreated = true;
    } else {
      await tx.$executeRaw`
        UPDATE workforce.principals
           SET display_name = ${input.displayName}, email = ${input.email},
               updated_by = ${actorId}::uuid
         WHERE id = ${principalId}::uuid
      `;
    }

    // ผูกเข้ากับทะเบียนพนักงานด้วยอีเมล ถ้ามีคนตรงกัน — ไม่มีคู่ก็ถูกต้อง
    // (เช่นแอดมินระบบที่ไม่ได้ถูกขึ้นทะเบียนเป็นพนักงาน)
    if (input.email !== null && input.email !== "") {
      await tx.$executeRaw`
        UPDATE workforce.principals p
           SET person_id = pe.id
          FROM workforce.people pe
         WHERE p.id = ${principalId}::uuid
           AND pe.tenant_id = ${input.orgId}::uuid
           AND pe.email = ${input.email}
      `;
    }

    const roleRows = await tx.$queryRaw<{ id: string; code: string }[]>`
      SELECT id::text AS id, code FROM workforce.roles WHERE tenant_id = ${input.orgId}::uuid
    `;
    const roleIdByCode = new Map(roleRows.map((r) => [r.code.toUpperCase(), r.id]));

    const current = await tx.$queryRaw<{ role_id: string; code: string; reason: string }[]>`
      SELECT a.role_id::text AS role_id, r.code, a.reason
        FROM workforce.principal_role_assignments a
        JOIN workforce.roles r ON r.id = a.role_id
       WHERE a.principal_id = ${principalId}::uuid
    `;
    const held = new Map(current.map((row) => [row.code.toUpperCase(), row]));

    const rolesGranted: SystemRole[] = [];
    for (const code of wanted) {
      if (held.has(code)) continue;
      const roleId = roleIdByCode.get(code);
      if (roleId === undefined) continue;
      await tx.$executeRaw`
        INSERT INTO workforce.principal_role_assignments
          (id, tenant_id, principal_id, role_id, reason, granted_by, created_by, updated_by)
        VALUES (${uuidv7()}::uuid, ${input.orgId}::uuid, ${principalId}::uuid, ${roleId}::uuid,
                ${SYNC_REASON}, ${actorId}::uuid, ${actorId}::uuid, ${actorId}::uuid)
        ON CONFLICT DO NOTHING
      `;
      rolesGranted.push(code);
    }

    // ถอน role ที่ระบบเคย sync ให้แต่สิทธิ์ปัจจุบันไม่ควรได้แล้ว
    // — แตะเฉพาะแถวที่ระบบสร้างเอง ไม่ยุ่งกับที่แอดมิน workforce มอบด้วยมือ
    const keep = new Set<string>(wanted);
    const rolesRevoked: string[] = [];
    for (const [code, row] of held) {
      if (keep.has(code) || row.reason !== SYNC_REASON) continue;
      await tx.$executeRaw`
        DELETE FROM workforce.principal_role_assignments
         WHERE principal_id = ${principalId}::uuid
           AND role_id = ${row.role_id}::uuid
           AND reason = ${SYNC_REASON}
      `;
      rolesRevoked.push(code);
    }

    return { principalCreated, rolesGranted, rolesRevoked };
  });
}

/**
 * ปิด/เปิดการเข้าถึงโมดูลบุคคลให้ตรงกับสถานะผู้ใช้ใน Smartboss
 *
 * ปิดผู้ใช้ใน Smartboss แล้วแต่ principal ยัง ACTIVE = token ที่ยังไม่หมดอายุ
 * ยังยิง workforce API ได้ต่อ ทั้งที่บัญชีถูกปิดไปแล้ว
 */
export async function setWorkforcePrincipalStatus(
  orgId: string,
  userId: string,
  isActive: boolean,
  actorId: string | null = null
): Promise<void> {
  await withWorkforceTenant(orgId, async (tx) => {
    await tx.$executeRaw`
      UPDATE workforce.principals
         SET status = ${isActive ? "ACTIVE" : "DISABLED"}, updated_by = ${actorId}::uuid
       WHERE tenant_id = ${orgId}::uuid AND subject = ${userId}
    `;
  });
}

/** ชื่อไทยของ role ระบบ — ต้องตรงกับ packages/workforce/db/src/seed/system-roles.ts */
const ROLE_NAMES: Record<SystemRole, string> = {
  EMPLOYEE: "พนักงาน",
  SUPERVISOR: "หัวหน้างาน",
  HR_OFFICER: "เจ้าหน้าที่บุคคล",
  PAYROLL_PREPARER: "ผู้จัดทำเงินเดือน",
  PAYROLL_APPROVER: "ผู้อนุมัติเงินเดือน",
  FINANCE_OFFICER: "เจ้าหน้าที่การเงิน",
  DEVICE_TECHNICIAN: "ช่างเทคนิคเครื่องสแกน",
  AUDITOR: "ผู้ตรวจสอบ",
  TENANT_ADMIN: "ผู้ดูแลองค์กร",
  SUPPORT_OPERATOR: "เจ้าหน้าที่สนับสนุน (ชั่วคราว)",
};
