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
export function ROLE_LABEL_TH(codes: string[], ceo = "CEO"): string {
  const c = codes.find((x) => ROLE_LABELS[x]);
  // ชื่อเรียกตำแหน่งสูงสุดของบริษัท (CEO/Boss) — lib/ceo-title.ts
  return c ? (c === "CEO" ? ceo : ROLE_LABELS[c]!) : "";
}
