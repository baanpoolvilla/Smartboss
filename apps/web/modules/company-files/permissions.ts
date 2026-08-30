/**
 * Permission codes ของโมดูลไฟล์บริษัท — สิทธิ์ระดับ "ทำอะไรได้บ้าง" ของ Smartboss RBAC
 * บริษัทกำหนดที่ /admin/roles หลังเปิดใช้โมดูลที่ /admin/modules แล้ว
 */
export const COMPANY_FILES_PERMS = {
  /** เข้าโมดูลได้ ดู/ดาวน์โหลด/พรีวิวไฟล์ได้ */
  access: "company_files.access",
  /** สร้างโฟลเดอร์ อัปโหลดไฟล์ใหม่/เวอร์ชันใหม่ สร้างลิงก์แชร์ */
  upload: "company_files.upload",
  /** ลบไฟล์/โฟลเดอร์ของคนอื่น เพิกถอนลิงก์แชร์ของคนอื่น */
  manage: "company_files.manage",
} as const;

export const ALL_COMPANY_FILES_PERMS: string[] = Object.values(COMPANY_FILES_PERMS);

export const COMPANY_FILES_PERM_LABELS: Record<string, string> = {
  [COMPANY_FILES_PERMS.access]: "เข้าใช้โมดูลไฟล์บริษัท (ดู/ดาวน์โหลด)",
  [COMPANY_FILES_PERMS.upload]: "อัปโหลดไฟล์ สร้างโฟลเดอร์ สร้างลิงก์แชร์",
  [COMPANY_FILES_PERMS.manage]: "ลบ/จัดการไฟล์และโฟลเดอร์ของคนอื่น",
};
