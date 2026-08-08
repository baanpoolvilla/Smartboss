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
 *   - ตัวตน (id, ชื่อ, อีเมล, สิทธิ์ระดับเจ้าของ) → มาจาก core.users เสมอ
 *   - ข้อมูลเฉพาะโมดูล (แผนก, ตำแหน่งที่แสดง, ตัวย่อ) → เก็บใน store คีย์
 *     "employee-profiles" ผูกด้วย core.users.id
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

/** ข้อมูลเฉพาะโมดูลที่ผูกกับ core.users.id */
interface EmployeeProfile {
  departmentId?: string;
  /** ตำแหน่งที่แสดงในโมดูลนี้ — ไม่ใช่ role ของระบบสิทธิ์ */
  jobTitle?: string;
  avatar?: string;
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
        roles: { select: { role: { select: { code: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    readStore<ProfileMap>(orgId, PROFILE_KEY),
  ]);

  const map = profiles.data ?? {};

  return users.map((u) => {
    const p = map[u.id] ?? {};
    const codes = u.roles.map((r) => r.role.code);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: p.avatar || initialsOf(u.name),
      role: p.jobTitle || codes[0] || "พนักงาน",
      departmentId: p.departmentId ?? "",
      isOwner: codes.some((c) => OWNER_ROLE_CODES.has(c)) || undefined,
    };
  });
}

/**
 * บันทึกเฉพาะส่วนที่โมดูลเป็นเจ้าของ
 *
 * ชื่อ/อีเมล/สิทธิ์เจ้าของ ที่ client ส่งมาจะถูกทิ้ง — แก้ได้ที่ /admin เท่านั้น
 * ไม่งั้นจะมีชื่อคนสองชุดที่ไม่ตรงกัน และแก้ที่นี่แล้ว login ไม่เปลี่ยนตาม
 */
export async function saveDirectoryProfiles(
  orgId: string,
  incoming: DirectoryUser[],
  updatedBy?: string
): Promise<void> {
  const valid = new Set(
    (
      await prisma.user.findMany({ where: { orgId }, select: { id: true } })
    ).map((u) => u.id)
  );

  const map: ProfileMap = {};
  for (const u of incoming) {
    if (!valid.has(u.id)) continue; // id ที่ไม่ใช่คนในบริษัทนี้ — ทิ้ง
    map[u.id] = {
      ...(u.departmentId ? { departmentId: u.departmentId } : {}),
      ...(u.role ? { jobTitle: u.role } : {}),
      ...(u.avatar ? { avatar: u.avatar } : {}),
    };
  }

  const current = await readStore<ProfileMap>(orgId, PROFILE_KEY);
  await writeStore(orgId, PROFILE_KEY, map, current.version, updatedBy);
}
