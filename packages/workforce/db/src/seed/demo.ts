import { uuidv7, type SystemRole } from '@workforce/domain';
import type { Db } from '../client';
import { withTenant } from '../client';
import {
  companies,
  compensationRates,
  employmentAssignments,
  employments,
  orgUnits,
  people,
  positions,
  principalRoleAssignments,
  principals,
  sites,
  tenants,
} from '../schema';
import { seedSystemRoles } from './system-roles';

export interface DemoSeedResult {
  tenantId: string;
  companyId: string;
  roleIds: Map<SystemRole, string>;
  principals: { subject: string; principalId: string; role: SystemRole }[];
  employmentIds: string[];
}

interface DemoPerson {
  firstName: string;
  lastName: string;
  preferredName: string;
  employeeCode: string;
  employmentType: 'MONTHLY' | 'DAILY' | 'HOURLY';
  hiredOn: string;
  salary: string;
  role: SystemRole;
}

/**
 * ข้อมูลตัวอย่างสำหรับ dev/demo — ไม่ใช่ข้อมูลจริงและไม่ใช้ใน production
 *
 * โครงสร้างเลียนแบบทีมของระบบเดิม (พนักงานรายเดือน + หัวหน้า + HR) เพื่อให้
 * เทียบ behaviour ระหว่าง parallel run ได้ง่าย
 */
const DEMO_PEOPLE: DemoPerson[] = [
  {
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    preferredName: 'ชาย',
    employeeCode: 'EMP-001',
    employmentType: 'MONTHLY',
    hiredOn: '2023-01-16',
    salary: '32000.0000',
    role: 'SUPERVISOR',
  },
  {
    firstName: 'สมหญิง',
    lastName: 'รักงาน',
    preferredName: 'หญิง',
    employeeCode: 'EMP-002',
    employmentType: 'MONTHLY',
    hiredOn: '2024-03-01',
    salary: '24000.0000',
    role: 'EMPLOYEE',
  },
  {
    firstName: 'ปรีชา',
    lastName: 'ตรงเวลา',
    preferredName: 'ชา',
    employeeCode: 'EMP-003',
    employmentType: 'DAILY',
    hiredOn: '2025-06-02',
    salary: '600.0000',
    role: 'EMPLOYEE',
  },
  {
    firstName: 'อารีย์',
    lastName: 'บุคคลดี',
    preferredName: 'อา',
    employeeCode: 'EMP-004',
    employmentType: 'MONTHLY',
    hiredOn: '2022-08-01',
    salary: '38000.0000',
    role: 'HR_OFFICER',
  },
];

export async function seedDemoTenant(
  db: Db,
  options: { tenantCode?: string; asOf?: string } = {},
): Promise<DemoSeedResult> {
  const tenantId = uuidv7();
  const companyId = uuidv7();
  const orgUnitId = uuidv7();
  const siteId = uuidv7();
  const positionId = uuidv7();
  const tenantCode = options.tenantCode ?? 'demo';
  const effectiveFrom = options.asOf ?? '2026-01-01';

  return withTenant(db, tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      code: tenantCode,
      name: 'Demo Tenant',
      defaultTimeZone: 'Asia/Bangkok',
      defaultCurrency: 'THB',
    });

    await tx.insert(companies).values({
      id: companyId,
      tenantId,
      code: 'MAIN',
      legalName: 'บริษัท เดโม จำกัด',
      displayName: 'Demo Co.',
      timeZone: 'Asia/Bangkok',
      currency: 'THB',
    });

    await tx.insert(orgUnits).values({
      id: orgUnitId,
      tenantId,
      companyId,
      code: 'OPS',
      name: 'ฝ่ายปฏิบัติการ',
      kind: 'DEPARTMENT',
    });

    await tx.insert(sites).values({
      id: siteId,
      tenantId,
      companyId,
      code: 'HQ',
      name: 'สำนักงานใหญ่',
      timeZone: 'Asia/Bangkok',
      latitude: '12.923100',
      longitude: '100.882600',
      radiusM: 150,
    });

    await tx.insert(positions).values({
      id: positionId,
      tenantId,
      companyId,
      code: 'STAFF',
      title: 'เจ้าหน้าที่',
    });

    const roleIds = await seedSystemRoles(tx, tenantId);

    const employmentIds: string[] = [];
    const seededPrincipals: DemoSeedResult['principals'] = [];
    let supervisorEmploymentId: string | null = null;

    for (const demo of DEMO_PEOPLE) {
      const personId = uuidv7();
      const employmentId = uuidv7();
      const principalId = uuidv7();

      await tx.insert(people).values({
        id: personId,
        tenantId,
        firstName: demo.firstName,
        lastName: demo.lastName,
        preferredName: demo.preferredName,
        email: `${demo.employeeCode.toLowerCase()}@demo.local`,
      });

      await tx.insert(employments).values({
        id: employmentId,
        tenantId,
        companyId,
        personId,
        employeeCode: demo.employeeCode,
        employmentType: demo.employmentType,
        hiredOn: demo.hiredOn,
        status: 'ACTIVE',
        primarySiteId: siteId,
        timeZone: 'Asia/Bangkok',
      });

      await tx.insert(employmentAssignments).values({
        id: uuidv7(),
        tenantId,
        employmentId,
        orgUnitId,
        positionId,
        siteId,
        managerEmploymentId:
          demo.role === 'SUPERVISOR' ? null : supervisorEmploymentId,
        effectiveFrom: demo.hiredOn,
      });

      await tx.insert(compensationRates).values({
        id: uuidv7(),
        tenantId,
        employmentId,
        payBasis: demo.employmentType === 'MONTHLY' ? 'MONTHLY' : 'DAILY',
        amount: demo.salary,
        currency: 'THB',
        effectiveFrom: effectiveFrom,
        provenance: 'MANUAL',
        note: 'demo seed',
      });

      await tx.insert(principals).values({
        id: principalId,
        tenantId,
        subject: `demo|${demo.employeeCode}`,
        displayName: `${demo.firstName} ${demo.lastName}`,
        email: `${demo.employeeCode.toLowerCase()}@demo.local`,
        personId,
      });

      const roleId = roleIds.get(demo.role);
      if (roleId !== undefined) {
        await tx.insert(principalRoleAssignments).values({
          id: uuidv7(),
          tenantId,
          principalId,
          roleId,
          companyId,
          reason: 'demo seed',
        });
      }

      if (demo.role === 'SUPERVISOR') supervisorEmploymentId = employmentId;
      employmentIds.push(employmentId);
      seededPrincipals.push({
        subject: `demo|${demo.employeeCode}`,
        principalId,
        role: demo.role,
      });
    }

    // ผู้ดูแลองค์กร: ไม่มี employment และไม่ได้สิทธิ์ payroll โดยอัตโนมัติ (spec §5)
    // Principal ที่ไม่ผูกกับ employment — คนเหล่านี้ทำงานกับระบบ ไม่ได้ตอกบัตร
    //
    // มีครบทุก role ที่เหลือโดยตั้งใจ: แต่ละขั้นของ flow (ผูกเครื่องสแกน →
    // ปิด timesheet → คำนวณเงินเดือน → อนุมัติ → จ่าย) ต้องใช้ permission คนละชุด
    // ถ้า seed ไม่มีคนถือ role นั้น จะเดินทั้ง flow บน dev ไม่ได้เลย
    const operators: { subject: string; displayName: string; role: SystemRole }[] = [
      { subject: 'demo|admin', displayName: 'Demo Administrator', role: 'TENANT_ADMIN' },
      { subject: 'demo|tech', displayName: 'Demo Device Technician', role: 'DEVICE_TECHNICIAN' },
      { subject: 'demo|payroll', displayName: 'Demo Payroll Preparer', role: 'PAYROLL_PREPARER' },
      { subject: 'demo|approver', displayName: 'Demo Payroll Approver', role: 'PAYROLL_APPROVER' },
      { subject: 'demo|finance', displayName: 'Demo Finance Officer', role: 'FINANCE_OFFICER' },
      { subject: 'demo|auditor', displayName: 'Demo Auditor', role: 'AUDITOR' },
    ];

    for (const operator of operators) {
      const principalId = uuidv7();
      await tx.insert(principals).values({
        id: principalId,
        tenantId,
        subject: operator.subject,
        displayName: operator.displayName,
        email: `${operator.subject.split('|')[1] ?? 'user'}@demo.local`,
      });

      const roleId = roleIds.get(operator.role);
      if (roleId !== undefined) {
        await tx.insert(principalRoleAssignments).values({
          id: uuidv7(),
          tenantId,
          principalId,
          roleId,
          reason: 'demo seed',
        });
      }

      seededPrincipals.push({ subject: operator.subject, principalId, role: operator.role });
    }

    return { tenantId, companyId, roleIds, principals: seededPrincipals, employmentIds };
  });
}
