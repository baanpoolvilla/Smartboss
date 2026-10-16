import { getDepartment, getUser, users } from "@/modules/report_task/lib/directory";

/**
 * "ตำแหน่ง" ในแม่แบบโปรเจกต์ — แม่แบบใส่ผู้รับผิดชอบเป็นตำแหน่ง (ช่าง, แม่บ้าน, จัดซื้อ…)
 * ตอนสร้างโปรเจกต์ค่อยเลือกคน · ตำแหน่งเป็นข้อความอิสระ ที่นี่แค่มีรายการแนะนำ + เดาคนตั้งต้นให้
 */
export const SUGGESTED_ROLES = ["ช่าง", "แม่บ้าน", "จัดซื้อ", "ฝ่ายขาย/OTA", "การตลาด", "IT", "เจ้าของโปรเจกต์"];

/** ตำแหน่งของคน (ตอนบันทึกโปรเจกต์เป็นแม่แบบ) — ใช้ตำแหน่งงานในระบบ ไม่มีก็ใช้ชื่อแผนก */
export function ROLE_OF_DEFAULT(userId: string): string {
  const u = getUser(userId);
  if (!u) return "ทีมงาน";
  return u.role?.trim() || getDepartment(u.departmentId ?? "")?.name || "ทีมงาน";
}

/** เดาคนที่น่าจะทำตำแหน่งนี้ — ตำแหน่งงาน/ชื่อแผนกมีคำนั้นอยู่ */
export function guessPersonForRole(role: string, fallback: string): string {
  const r = role.toLowerCase();
  const hit = users.find((u) => {
    const dep = getDepartment(u.departmentId ?? "")?.name ?? "";
    return (u.role ?? "").toLowerCase().includes(r) || dep.toLowerCase().includes(r);
  });
  return hit?.id ?? fallback;
}
