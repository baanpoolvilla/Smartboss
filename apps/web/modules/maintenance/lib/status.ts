/** metadata ของสถานะ/ความสำคัญใบงาน — สีตรงกับของเดิม (ChangYai) */

export type WoStatus = "open" | "in_progress" | "completed" | "cancelled";
export type WoPriority = "low" | "medium" | "high" | "urgent";

export const WO_STATUS: Record<WoStatus, { label: string; color: string }> = {
  open: { label: "เปิด", color: "#DC2626" },
  in_progress: { label: "กำลังดำเนินการ", color: "#EA580C" },
  completed: { label: "เสร็จแล้ว", color: "#16A34A" },
  cancelled: { label: "ยกเลิก", color: "#6B7280" },
};

export const WO_PRIORITY: Record<WoPriority, { label: string; color: string }> = {
  urgent: { label: "เร่งด่วน", color: "#DC2626" },
  high: { label: "สูง", color: "#EA580C" },
  medium: { label: "ปานกลาง", color: "#2563EB" },
  low: { label: "ต่ำ", color: "#6B7280" },
};

export function statusMeta(s: string) {
  return WO_STATUS[s as WoStatus] ?? { label: s, color: "#6B7280" };
}
export function priorityMeta(p: string) {
  return WO_PRIORITY[p as WoPriority] ?? { label: p, color: "#6B7280" };
}

export const WO_STATUS_OPTIONS: { value: WoStatus; label: string }[] = [
  { value: "open", label: "เปิด" },
  { value: "in_progress", label: "กำลังดำเนินการ" },
  { value: "completed", label: "เสร็จแล้ว" },
  { value: "cancelled", label: "ยกเลิก" },
];

export const WO_PRIORITY_OPTIONS: { value: WoPriority; label: string }[] = [
  { value: "low", label: "ต่ำ" },
  { value: "medium", label: "ปานกลาง" },
  { value: "high", label: "สูง" },
  { value: "urgent", label: "เร่งด่วน" },
];
