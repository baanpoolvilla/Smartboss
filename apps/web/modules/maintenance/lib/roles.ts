/** ชื่อบทบาทภาษาไทย — แม็พจาก UserRole.displayName เดิมของ ChangYai */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  CEO: "CEO",
  MANAGER: "ผู้จัดการ",
  CARETAKER: "ผู้ดูแลบ้าน",
  TECHNICIAN: "ช่าง",
  STAFF: "พนักงาน",
};

/** ป้ายบทบาทตัวแรกที่รู้จักจากรายการ role code ของผู้ใช้ */
export function ROLE_LABEL_TH(codes: string[]): string {
  const c = codes.find((x) => ROLE_LABELS[x]);
  return c ? ROLE_LABELS[c]! : "";
}
