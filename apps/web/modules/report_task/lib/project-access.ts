import { departments, getUser, isDepartmentHead, isOwner } from "@/modules/report_task/lib/directory";
import type { Project } from "@/modules/report_task/types";

/**
 * สิทธิ์ของโปรเจกต์ (ตัดสินฝั่งหน้าจอ เหมือน store อื่นของโมดูลนี้)
 * - สร้างโปรเจกต์ / แก้แม่แบบ: CEO + หัวหน้าแผนก
 * - เห็น: CEO · สมาชิก · หัวหน้าแผนกที่มีลูกน้องเป็นสมาชิก
 * - แก้ (เพิ่มงาน/Milestone/ช่วงงาน, อัปเดตสถานะ): CEO · เจ้าของ · สมาชิกแบบ "แก้ได้"
 * - คุมแผน (ลากเลื่อนกำหนดส่งบน Timeline, ตั้งค่าการเลื่อน, จัดการสมาชิก): CEO · เจ้าของโปรเจกต์
 *   — ตกลงกับผู้ใช้ 16/10/2569 · คนอื่นยังใช้ "ขอเลื่อน" บนบอร์ดงานตามเดิม
 */

export function canCreateProject(me: string): boolean {
  return isOwner(me) || isDepartmentHead(me);
}

export function memberRole(p: Project, me: string): "owner" | "editor" | "viewer" | null {
  if (p.ownerId === me) return "owner";
  return p.members.find((m) => m.userId === me)?.role ?? null;
}

export function canSeeProject(p: Project, me: string): boolean {
  if (isOwner(me) || memberRole(p, me)) return true;
  const headed = new Set(departments.filter((d) => d.headId === me).map((d) => d.id));
  if (headed.size === 0) return false;
  return [p.ownerId, ...p.members.map((m) => m.userId)].some((id) => {
    const dep = getUser(id)?.departmentId;
    return !!dep && headed.has(dep);
  });
}

export function canEditProject(p: Project, me: string): boolean {
  const r = memberRole(p, me);
  return isOwner(me) || r === "owner" || r === "editor";
}

export function canPlanProject(p: Project, me: string): boolean {
  return isOwner(me) || p.ownerId === me;
}
