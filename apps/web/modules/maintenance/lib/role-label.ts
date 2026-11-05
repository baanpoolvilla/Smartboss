/** ป้ายบทบาทสั้น ๆ ใต้ชื่อในตัวเลือกผู้รับผิดชอบ (ฟอร์มใบงาน / แก้ทีม / แผน PM) */
const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "ผู้ดูแลระบบ",
  CEO: "เจ้าของ",
  MANAGER: "ผู้จัดการ",
  CARETAKER: "ผู้ดูแลบ้าน",
  TECHNICIAN: "ช่าง",
  STAFF: "พนักงาน",
};
export function roleLabel(codes: string[]): string {
  const c = codes.find((x) => ROLE_LABEL[x]);
  return c ? ROLE_LABEL[c]! : "";
}
