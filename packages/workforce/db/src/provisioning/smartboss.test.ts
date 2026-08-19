import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/harness';
import { withTenant } from '../client';
import { companies, principalRoleAssignments, principals, roles, tenants } from '../schema';
import { mapSmartbossRoles, provisionPrincipal, provisionTenant } from './smartboss';

describe('mapSmartbossRoles', () => {
  it('ผู้ที่อนุมัติเงินเดือนได้ ต้องไม่ได้สิทธิ์จัดทำงวดด้วย (แยกหน้าที่)', () => {
    const result = mapSmartbossRoles({
      roles: ['CEO'],
      permissions: ['hr.payroll.approve', 'hr.payroll.manage', 'hr.salary.manage'],
    });

    expect(result).toContain('PAYROLL_APPROVER');
    expect(result).not.toContain('PAYROLL_PREPARER');
  });

  it('ผู้จัดทำงวดที่อนุมัติไม่ได้ ได้ PREPARER', () => {
    const result = mapSmartbossRoles({
      roles: ['HR_OFFICER'],
      permissions: ['hr.payroll.manage', 'hr.employee.view'],
    });

    expect(result).toContain('PAYROLL_PREPARER');
    expect(result).not.toContain('PAYROLL_APPROVER');
  });

  it('SUPER_ADMIN / ADMIN → ผู้ดูแลองค์กร', () => {
    expect(mapSmartbossRoles({ roles: ['SUPER_ADMIN'], permissions: [] })).toContain(
      'TENANT_ADMIN',
    );
    expect(mapSmartbossRoles({ roles: ['ADMIN'], permissions: [] })).toContain('TENANT_ADMIN');
  });

  it('MANAGER → หัวหน้างาน, สิทธิ์จัดการพนักงาน → เจ้าหน้าที่บุคคล', () => {
    const result = mapSmartbossRoles({
      roles: ['MANAGER'],
      permissions: ['hr.employee.manage'],
    });
    expect(result).toEqual(expect.arrayContaining(['SUPERVISOR', 'HR_OFFICER']));
  });

  it('คนที่ตั้งค่าโมดูลได้ ต้องจัดการเครื่องสแกนได้ด้วย', () => {
    // หน้า /hr/devices เปิดให้คนที่มี hr.setting.manage — ถ้าไม่ได้ DEVICE_TECHNICIAN
    // ปุ่มลงทะเบียนเครื่อง/ออกโทเคน/ผูกลายนิ้วมือจะกดแล้ว 403 ทุกครั้ง
    const result = mapSmartbossRoles({
      roles: [],
      permissions: ['hr.setting.manage'],
    });
    expect(result).toEqual(expect.arrayContaining(['HR_OFFICER', 'DEVICE_TECHNICIAN']));
  });

  it('ทุกคนได้ EMPLOYEE เป็นอย่างน้อย', () => {
    expect(mapSmartbossRoles({ roles: [], permissions: [] })).toEqual(['EMPLOYEE']);
  });

  it('ผลลัพธ์เรียงคงที่และไม่ซ้ำ', () => {
    const result = mapSmartbossRoles({
      roles: ['SUPER_ADMIN', 'MANAGER', 'HR_OFFICER'],
      permissions: ['hr.employee.manage', 'hr.setting.manage'],
    });
    expect(new Set(result).size).toBe(result.length);
    expect(result).toEqual([...result].sort((a, b) => result.indexOf(a) - result.indexOf(b)));
  });
});

describe('provisioning จาก Smartboss', () => {
  let database: TestDatabase;
  const orgId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  it('สร้าง tenant จาก Organization ของ Smartboss พร้อม role ตั้งต้น', async () => {
    const result = await provisionTenant(database.db, {
      tenantId: orgId,
      code: 'demo-org',
      name: 'บริษัทตัวอย่าง',
    });

    expect(result.created).toBe(true);
    expect(result.roleIds.size).toBeGreaterThan(0);
    expect(result.companyCreated).toBe(true);
    expect(result.companyId).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await withTenant(database.db, orgId, (tx) =>
      tx.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, orgId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('บริษัทตัวอย่าง');
  });

  it('สร้างนิติบุคคลตั้งต้นให้ด้วย — ผู้ใช้ต้องไม่ต้องมากรอกชื่อบริษัทซ้ำ', async () => {
    // ทุกอย่างในโมดูลบุคคล (พนักงาน กะ งวด เครื่องสแกน) ต้องมี company_id
    // ถ้า provision แล้วยังไม่มี company หน้า /hr จะเด้งฟอร์มให้กรอกชื่อบริษัท
    // ซ้ำกับที่กรอกไปแล้วตอนเปิดบริษัทใน Smartboss
    const rows = await withTenant(database.db, orgId, (tx) =>
      tx
        .select({
          id: companies.id,
          code: companies.code,
          legalName: companies.legalName,
          displayName: companies.displayName,
        })
        .from(companies)
        .where(eq(companies.tenantId, orgId)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.legalName).toBe('บริษัทตัวอย่าง');
    expect(rows[0]?.displayName).toBe('บริษัทตัวอย่าง');
    // ไม่ได้ส่ง companyCode มา จึงถอยไปใช้ code ของ tenant
    expect(rows[0]?.code).toBe('demo-org');
  });

  it('companyCode ที่ส่งมาชนะ code ของ tenant', async () => {
    const otherOrgId = randomUUID();
    const result = await provisionTenant(database.db, {
      tenantId: otherOrgId,
      code: 'acme',
      companyCode: 'SM0002',
      name: 'บริษัททดสอบ ACME',
    });

    expect(result.companyCreated).toBe(true);
    const rows = await withTenant(database.db, otherOrgId, (tx) =>
      tx.select({ code: companies.code }).from(companies).where(eq(companies.id, result.companyId)),
    );
    expect(rows[0]?.code).toBe('SM0002');
  });

  it('เรียกซ้ำไม่สร้างซ้ำ', async () => {
    const again = await provisionTenant(database.db, {
      tenantId: orgId,
      code: 'demo-org',
      name: 'บริษัทตัวอย่าง',
    });
    expect(again.created).toBe(false);
    expect(again.companyCreated).toBe(false);

    const companyRows = await withTenant(database.db, orgId, (tx) =>
      tx.select({ id: companies.id }).from(companies).where(eq(companies.tenantId, orgId)),
    );
    expect(companyRows).toHaveLength(1);

    const roleRows = await withTenant(database.db, orgId, (tx) =>
      tx.select({ id: roles.id }).from(roles),
    );
    // seed ซ้ำต้องไม่เพิ่ม role ใหม่
    expect(roleRows.length).toBe(again.roleIds.size);
  });

  it('สร้าง principal โดยใช้ User.id เป็น subject', async () => {
    const result = await provisionPrincipal(database.db, {
      tenantId: orgId,
      subject: userId,
      displayName: 'Super Admin',
      email: 'admin@easyboss.app',
      workforceRoles: mapSmartbossRoles({ roles: ['SUPER_ADMIN'], permissions: [] }),
    });

    expect(result.created).toBe(true);
    expect(result.rolesGranted).toEqual(expect.arrayContaining(['TENANT_ADMIN', 'EMPLOYEE']));

    const rows = await withTenant(database.db, orgId, (tx) =>
      tx
        .select({ subject: principals.subject, name: principals.displayName })
        .from(principals)
        .where(eq(principals.subject, userId)),
    );
    expect(rows[0]?.subject).toBe(userId);
  });

  it('เรียกซ้ำแล้วอัปเดตชื่อ ไม่สร้าง principal ซ้ำ และไม่ให้ role ซ้ำ', async () => {
    const again = await provisionPrincipal(database.db, {
      tenantId: orgId,
      subject: userId,
      displayName: 'ชื่อใหม่',
      email: 'admin@easyboss.app',
      workforceRoles: mapSmartbossRoles({ roles: ['SUPER_ADMIN'], permissions: [] }),
    });

    expect(again.created).toBe(false);
    expect(again.rolesGranted).toEqual([]);

    const rows = await withTenant(database.db, orgId, (tx) =>
      tx
        .select({ id: principals.id, name: principals.displayName })
        .from(principals)
        .where(eq(principals.subject, userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('ชื่อใหม่');

    const assignments = await withTenant(database.db, orgId, (tx) =>
      tx
        .select({ roleId: principalRoleAssignments.roleId })
        .from(principalRoleAssignments)
        .where(eq(principalRoleAssignments.principalId, again.principalId)),
    );
    expect(new Set(assignments.map((a) => a.roleId)).size).toBe(assignments.length);
  });

  it('ข้อมูลของอีกบริษัทมองไม่เห็นข้ามกัน (RLS)', async () => {
    const otherOrgId = randomUUID();
    await provisionTenant(database.db, {
      tenantId: otherOrgId,
      code: 'other-org',
      name: 'อีกบริษัท',
    });

    const seenFromOther = await withTenant(database.db, otherOrgId, (tx) =>
      tx.select({ subject: principals.subject }).from(principals),
    );
    expect(seenFromOther.map((row) => row.subject)).not.toContain(userId);
  });
});
