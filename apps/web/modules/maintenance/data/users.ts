import "server-only";
import { prisma } from "@smartboss/database";

/** ผู้ใช้ทั้งหมดในบริษัท (ไว้ทำ dropdown มอบหมาย/ผู้ดูแล) */
export async function listOrgUsers(orgId: string) {
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      roles: { select: { role: { select: { code: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roleCodes: u.roles.map((r) => r.role.code),
  }));
}

/** map userId -> ชื่อ (ไว้แสดงชื่อจาก id ที่เก็บไว้) */
export async function userNameMap(
  orgId: string,
  ids: (string | null | undefined)[]
): Promise<Record<string, string>> {
  const clean = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (clean.length === 0) return {};
  const users = await prisma.user.findMany({
    where: { orgId, id: { in: clean } },
    select: { id: true, name: true },
  });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

/** เฉพาะช่าง (role TECHNICIAN) — ไว้มอบหมายงาน */
export async function listTechnicians(orgId: string) {
  const all = await listOrgUsers(orgId);
  const techs = all.filter((u) => u.roleCodes.includes("TECHNICIAN"));
  return techs.length > 0 ? techs : all; // fallback: ทั้งหมด (เหมือนของเดิม)
}

/** ผู้ใช้ในบริษัท + lineUserId (สำหรับหน้าตั้งค่า/แอดมิน) */
export async function listOrgUsersFull(orgId: string) {
  const users = await prisma.user.findMany({
    where: { orgId },
    select: {
      id: true,
      name: true,
      email: true,
      lineUserId: true,
      roles: { select: { role: { select: { code: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    lineUserId: u.lineUserId,
    roleCodes: u.roles.map((r) => r.role.code),
  }));
}

/**
 * การแก้ไขผู้ใช้/บทบาท ย้ายไป modules/admin แล้ว (หน้า /admin/users)
 * ฟังก์ชันเดิมที่ค้นหา role ด้วย code แบบ global ใช้ไม่ได้อีก เพราะ role แยกตามบริษัทแล้ว
 * ไฟล์นี้จึงเหลือเฉพาะฟังก์ชัน "อ่าน" ที่โมดูล maintenance ใช้
 */
