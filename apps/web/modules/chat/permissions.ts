/**
 * Permission codes ของโมดูลแชท — สิทธิ์ระดับ "เข้าหน้าไหนได้บ้าง" ของ Smartboss RBAC
 * บริษัทกำหนดที่ /admin/roles หลังเปิดใช้โมดูลที่ /admin/modules แล้ว
 */
export const CHAT_PERMS = {
  /** เข้าโมดูลแชทได้ (เห็นเมนู, ส่งข้อความ/DM/สร้างกลุ่ม) */
  access: "chat.access",
  /** ตั้งค่าโมดูล (สงวนไว้ก่อน — ยังไม่มีหน้าตั้งค่าใน MVP นี้) */
  manage: "chat.manage",
} as const;

export const ALL_CHAT_PERMS: string[] = Object.values(CHAT_PERMS);

export const CHAT_PERM_LABELS: Record<string, string> = {
  [CHAT_PERMS.access]: "เข้าใช้โมดูลแชท",
  [CHAT_PERMS.manage]: "จัดการตั้งค่าโมดูลแชท",
};
