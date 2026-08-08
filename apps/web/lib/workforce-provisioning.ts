import "server-only";
import { prisma } from "@smartboss/database";
import {
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
  actorId: string | null = null
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

    return { tenantCreated, rolesCreated };
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
