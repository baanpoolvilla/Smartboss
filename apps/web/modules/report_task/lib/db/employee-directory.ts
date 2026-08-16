import "server-only";
import { prisma } from "@smartboss/database";

import { readStore, writeStore } from "./org-store";

/**
 * รายชื่อพนักงานของโมดูล — สร้างจาก `core.users` ของบริษัท ไม่ใช่รายชื่อแยกของตัวเอง
 *
 * ทำไม: ระบบนี้ต้องตอบให้ได้ว่า "คนคนนี้ทำงานเป็นอย่างไร" โดยรวมงานจากทุกโมดูล
 * ถ้าโมดูลนี้มีรายชื่อคนของตัวเอง (usr-01, usr-02 ...) คะแนนที่หักในบอร์ด Kanban
 * จะผูกกับคนละคนกับที่ถูกหักในใบแจ้งซ่อม แล้วสรุปรวมไม่ได้
 *
 * แบ่งความเป็นเจ้าของชัดเจน:
 *   - ตัวตน (id, ชื่อ, อีเมล, สิทธิ์ระดับเจ้าของ, แผนก) → มาจาก core.users เสมอ
 *     (แผนกจัดการที่ /admin/departments, /admin/users/{id} — เดิมเป็น jobTitle
 *     ข้อความอิสระเก็บแยกที่นี่ ย้ายไป core แล้วตั้งแต่มี Department เป็นของกลาง
 *     ส่วน "ตำแหน่ง" ถูกตัดออกทั้งระบบ สิทธิ์การใช้งานมาจาก Role อย่างเดียว)
 *   - ข้อมูลเฉพาะโมดูล (ตัวย่อ) → เก็บใน store คีย์ "employee-profiles" ผูกด้วย
 *     core.users.id
 *
 * ผลคือเพิ่มผู้ใช้ที่ /admin แล้วโผล่ในโมดูลนี้ทันที และปิดผู้ใช้ก็หายไปเอง
 */

/** รูปร่าง User ที่ฝั่ง client ของโมดูลใช้ (types/index.ts) */
export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  departmentId: string;
  isOwner?: boolean;
}

/**
 * ข้อมูลเฉพาะโมดูลที่ผูกกับ core.users.id — ตัวย่อ + ข้อยกเว้นสถานะเจ้าของ
 *
 * isOwnerOverride: ค่าเริ่มต้นของ "เจ้าของบริษัท" มาจาก role จริง (ADMIN/CEO/
 * SUPER_ADMIN) เสมอ แต่บางบริษัทอยากยกเว้นเป็นรายคนได้ (เช่น ADMIN ที่ดูแล
 * แค่เรื่องผู้ใช้/สิทธิ์ ไม่ต้องการเห็นข้อมูลรายงาน/งานข้ามแผนกทั้งบริษัทก็ได้)
 * — undefined = ตามค่าจาก role ปกติ, true/false = บังคับทับ ไม่สนใจ role
 * ตั้งได้เฉพาะที่หน้า "จัดการพนักงาน" (owner เท่านั้นที่เข้าถึงได้ ดู
 * settings/page.tsx sectionsByTab.permissions) ไม่กระทบสิทธิ์เมนู/RBAC จริง
 * เลย เป็นแค่ scope ภายในโมดูลนี้ (isOwner ที่นี่ ≠ role ที่ /admin)
 */
interface EmployeeProfile {
  avatar?: string;
  isOwnerOverride?: boolean;
}

type ProfileMap = Record<string, EmployeeProfile>;

const PROFILE_KEY = "employee-profiles";

/**
 * role ของ Smartboss ที่ถือว่า "เห็นและแก้ได้ทั้งบริษัท" ในโมดูลนี้
 * ตรงกับ isOwner เดิมที่โมดูลใช้ตัดสินสิทธิ์ระดับเรคคอร์ด
 */
const OWNER_ROLE_CODES = new Set(["SUPER_ADMIN", "ADMIN", "CEO"]);

/** ตัวย่อจากชื่อ — ใช้เมื่อยังไม่ได้ตั้งเอง */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`;
}

export async function listDirectory(orgId: string): Promise<DirectoryUser[]> {
  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        departmentId: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    readStore<ProfileMap>(orgId, PROFILE_KEY),
  ]);

  const map = profiles.data ?? {};

  return users.map((u) => {
    const p = map[u.id] ?? {};
    const codes = u.roles.map((r) => r.role.code);
    const roleDerived = codes.some((c) => OWNER_ROLE_CODES.has(c));
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: p.avatar || initialsOf(u.name),
      role: primaryRoleOf(u.roles)?.role.name || "พนักงาน",
      departmentId: u.departmentId ?? "",
      isOwner: (p.isOwnerOverride ?? roleDerived) || undefined,
    };
  });
}

/**
 * เลือก role "หลัก" ของคนที่ถือหลาย role มาแสดงเป็นตำแหน่งในรายชื่อ
 *
 * `UserRole` ไม่มีคอลัมน์ลำดับ (คีย์หลักคือ [userId, roleId]) และ query ไม่ได้
 * ใส่ orderBy ไว้ ผลคือ `roles[0]` ที่นี่จะไม่คงที่ — สลับไปมาระหว่างคำขอ/คนละ
 * deploy โดยไม่มีข้อมูลเปลี่ยนเลยก็ได้ ถ้าคนคนนึงถือมากกว่า 1 role ให้ role
 * ระดับเจ้าของ (ตาม OWNER_ROLE_CODES เดียวกับที่ใช้ตัดสิน isOwner ด้านบน) ขึ้น
 * ก่อนเสมอ ที่เหลือเรียงตามชื่อ role ให้อย่างน้อยผลลัพธ์คงที่ทุกครั้ง
 */
function primaryRoleOf(roles: { role: { code: string; name: string } }[]) {
  return [...roles].sort((a, b) => {
    const aOwner = OWNER_ROLE_CODES.has(a.role.code) ? 0 : 1;
    const bOwner = OWNER_ROLE_CODES.has(b.role.code) ? 0 : 1;
    return aOwner !== bOwner ? aOwner - bOwner : a.role.name.localeCompare(b.role.name);
  })[0];
}

/**
 * บันทึกเฉพาะส่วนที่โมดูลเป็นเจ้าของ (ตัวย่อ + ข้อยกเว้นสถานะเจ้าของ)
 *
 * ชื่อ/อีเมล/แผนก/ตำแหน่ง ที่ client ส่งมาจะถูกทิ้ง — แก้ได้ที่ /admin เท่านั้น
 * ไม่งั้นจะมีข้อมูลคนสองชุดที่ไม่ตรงกัน และแก้ที่นี่แล้ว login ไม่เปลี่ยนตาม
 * ส่วน "เจ้าของบริษัท" รับได้ แต่เก็บเป็น **ข้อยกเว้น** ไม่ใช่ค่าเต็ม — เทียบกับ
 * role จริงของแต่ละคนก่อนเสมอ ถ้าตรงกับที่ role กำหนดอยู่แล้วไม่ต้องเก็บ
 * (กันไม่ให้ค่าเก่าค้างบัง role ใหม่ตอนมีคนเปลี่ยน role ทีหลังที่ /admin)
 */
export async function saveDirectoryProfiles(
  orgId: string,
  incoming: DirectoryUser[],
  updatedBy?: string
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { orgId },
    select: { id: true, roles: { select: { role: { select: { code: true } } } } },
  });
  const roleDerivedById = new Map(
    users.map((u) => [u.id, u.roles.some((r) => OWNER_ROLE_CODES.has(r.role.code))])
  );

  const map: ProfileMap = {};
  for (const u of incoming) {
    const roleDerived = roleDerivedById.get(u.id);
    if (roleDerived === undefined) continue; // id ที่ไม่ใช่คนในบริษัทนี้ — ทิ้ง
    const isOwnerSent = u.isOwner === true;
    map[u.id] = {
      ...(u.avatar ? { avatar: u.avatar } : {}),
      // เก็บเฉพาะตอนขัดกับ role จริง — ตรงกันอยู่แล้วไม่ต้องเก็บข้อยกเว้น
      ...(isOwnerSent !== roleDerived ? { isOwnerOverride: isOwnerSent } : {}),
    };
  }

  const current = await readStore<ProfileMap>(orgId, PROFILE_KEY);
  await writeStore(orgId, PROFILE_KEY, map, current.version, updatedBy);
}
