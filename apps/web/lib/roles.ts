/** ป้ายชื่อ role ภาษาไทย (ตรงกับ seed) */
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "ผู้ดูแลระบบสูงสุด",
  MANAGER: "ผู้จัดการ",
  HR_OFFICER: "เจ้าหน้าที่บุคคล",
  ACCOUNTANT: "นักบัญชี",
  SALE_ADMIN: "แอดมินฝ่ายขาย",
  MARKETING: "การตลาด",
  TECHNICIAN: "ช่างเทคนิค",
  STAFF: "พนักงานทั่วไป",
};

export function roleLabel(roles: string[]): string {
  if (roles.length === 0) return "ผู้ใช้งาน";
  return ROLE_LABELS[roles[0]!] ?? roles[0]!;
}
