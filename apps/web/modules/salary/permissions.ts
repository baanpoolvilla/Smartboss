/**
 * สิทธิ์ของโมดูลเงินเดือน — แคตตาล็อกอยู่ใต้โมดูล hr (manifest ใช้ requiresModule: "hr")
 * รหัสตรงกับ SALARY_PERMS ใน packages/database/defaults.ts และ migration 20261022150000_salary_module
 *
 * มีแค่ "เข้าเมนูเงินเดือน / ดูสลิปของตัวเอง" — ทุกบทบาทยกเว้นคนงาน
 * ใครเห็น/แก้เงินเดือนของคนอื่นไม่ได้ตัดสินจากบทบาท แต่จาก CEO + รายชื่อที่ CEO เลือก
 * (ผู้ใช้กำหนด 22/10/2569 — ดู lib/access.ts) แอดมินจึงติ๊กสิทธิ์ให้ตัวเองเห็นเงินเดือนคนอื่นไม่ได้
 */
export const SALARY_PERMS = {
  access: "salary.access",
} as const;

/**
 * ไม่ใช่สิทธิ์ในฐานข้อมูล — ใช้ติดเมนูที่เฉพาะ "คนทำเงินเดือน" (CEO + คนที่ CEO เลือก, lib/access.ts) เห็น
 * lib/nav.ts ใส่ให้คนที่แก้เงินเดือนได้ และตัดเมนูนี้ออกจากคนอื่น (รวม SUPER_ADMIN ที่ไม่ได้รับเลือก)
 */
export const SALARY_EDIT_MENU = "salary.__edit_menu";

export const SALARY_PERM_LABELS: Record<string, string> = {
  [SALARY_PERMS.access]: "เงินเดือน: ดูสลิปของตัวเอง (คนที่เห็น/แก้เงินเดือนทุกคน CEO เลือกที่ เงินเดือน › ตั้งค่า)",
};
