import "server-only";
import { prisma } from "@smartboss/database";

/**
 * แผนกของบริษัท — ของกลาง (core.departments) ใช้ร่วมกันได้ทุกโมดูล
 * ไม่มี "แผนกระดับระบบ" เหมือน Role (orgId = null) — ทุกแผนกเป็นของบริษัทเดียวเสมอ
 *
 * ไม่มีสิทธิ์ของตัวเองแล้ว (ยุบไปที่ Role ทางเดียว) — เก็บแค่ข้อมูลโครงสร้างองค์กร
 * + หัวหน้าแผนก ซึ่งคุม data scope แยกจาก permission โดยสิ้นเชิง (ดู packages/auth/scope.ts)
 */
export async function listDepartments(orgId: string) {
  const departments = await prisma.department.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { users: true, heads: true } },
    },
  });

  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    userCount: d._count.users,
    headCount: d._count.heads,
  }));
}

export type DepartmentRow = Awaited<ReturnType<typeof listDepartments>>[number];

/** กี่แผนกที่ user คนนี้เป็นหัวหน้าอยู่ — ใช้เตือนก่อนลบผู้ใช้ (ดู deleteUserAction) */
export async function countDepartmentsHeadedBy(userId: string) {
  return prisma.departmentHead.count({ where: { userId } });
}

/**
 * หัวหน้าแผนกที่โมดูล "รายงานและงาน" ตั้งไว้เอง (แยกจาก core.department_heads
 * ข้างบนโดยสิ้นเชิง) — โมดูลนั้นยังไม่ได้อ่าน core.department_heads เลย มีตัวตั้ง
 * หัวหน้าแผนกของตัวเองในหน้าตั้งค่าโมดูล ถ้าตั้งไว้คนละคนกับที่นี่ สองระบบจะไม่
 * ตรงกันโดยไม่มีอะไรเตือน — อ่านตรงจากตาราง `report_task.stores` เอาเฉพาะคีย์
 * "department-overlay" (รูปแบบเดียวกับที่ apps/web/modules/report_task/lib/db/
 * departments.ts เขียน) แทนที่จะ import โค้ดของโมดูลนั้นเข้ามา เพื่อไม่ให้ผูก
 * กันเป็นโมดูล-ต่อ-โมดูล แค่ต้องการอ่านค่าไปเทียบเฉยๆ
 */
export async function getReportTaskDepartmentHeadId(orgId: string, departmentId: string): Promise<string | null> {
  const row = await prisma.reportTaskStore.findUnique({
    where: { orgId_key: { orgId, key: "department-overlay" } },
    select: { data: true },
  });
  const map = row?.data as Record<string, { headId?: string }> | null;
  return map?.[departmentId]?.headId || null;
}

export async function getDepartment(orgId: string, departmentId: string) {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
    include: {
      heads: { include: { user: { select: { id: true, name: true, departmentId: true } } } },
    },
  });
  if (!department) return null;
  return {
    id: department.id,
    orgId: department.orgId,
    name: department.name,
    description: department.description,
    heads: department.heads.map((h) => ({ userId: h.user.id, name: h.user.name })),
  };
}
