/**
 * สีประจำประเภทลา — ใช้ทุกจุดในหน้ารายงานการเข้างาน (ป้ายสรุป · ช่องรายคน · รายวัน)
 * ให้ HR/CEO เห็นปุ๊บรู้ว่าลาอะไร (ผู้ใช้ 10/11/2569) · ชื่อประเภทตั้งเองได้ จึงจับจากคำในชื่อ
 * ตัวหนังสือเข้มบนพื้นอ่อน ผ่านคอนทราสต์ 4.5:1
 */
export interface LeaveColor {
  fg: string;
  bg: string;
  dot: string;
}

const SICK: LeaveColor = { fg: "#b91c1c", bg: "#fee2e2", dot: "#dc2626" };
const VACATION: LeaveColor = { fg: "#1d4ed8", bg: "#dbeafe", dot: "#2563eb" };
const BUSINESS: LeaveColor = { fg: "#b45309", bg: "#fef3c7", dot: "#d97706" };
const UNKNOWN: LeaveColor = { fg: "#4b5563", bg: "#f3f4f6", dot: "#9ca3af" };
const OTHERS: LeaveColor[] = [
  { fg: "#0f766e", bg: "#ccfbf1", dot: "#14b8a6" },
  { fg: "#6d28d9", bg: "#ede9fe", dot: "#8b5cf6" },
  { fg: "#be185d", bg: "#fce7f3", dot: "#ec4899" },
  { fg: "#4338ca", bg: "#e0e7ff", dot: "#6366f1" },
];

export function leaveColor(name: string): LeaveColor {
  if (name.includes("ไม่ระบุ")) return UNKNOWN;
  if (name.includes("ป่วย") || /sick/i.test(name)) return SICK;
  if (name.includes("พักร้อน") || /vacation|annual/i.test(name)) return VACATION;
  if (name.includes("กิจ") || /personal|business/i.test(name)) return BUSINESS;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return OTHERS[h % OTHERS.length]!;
}
