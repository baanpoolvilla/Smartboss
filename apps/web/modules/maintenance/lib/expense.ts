export const COST_TYPE_LABEL: Record<string, string> = {
  work_order: "ใบงาน",
  pm: "PM (บำรุงรักษา)",
};
export const PAID_BY_LABEL: Record<string, string> = {
  company: "บริษัท",
  owner: "เจ้าของบ้าน",
};
export const CATEGORY_LABEL: Record<string, string> = {
  material: "วัสดุ",
  labor: "ค่าแรง",
  contractor: "ผู้รับเหมา",
};

export function costTypeLabel(v: string): string {
  return COST_TYPE_LABEL[v] ?? v;
}
export function paidByLabel(v: string): string {
  return PAID_BY_LABEL[v] ?? v;
}
export function categoryLabel(v: string | null | undefined): string {
  if (!v) return "อื่น ๆ";
  return CATEGORY_LABEL[v] ?? v;
}

/** ฿1,234 (ไม่มีทศนิยม) — ตรงกับของเดิม */
export function formatBaht(n: number): string {
  return "฿" + Math.round(n).toLocaleString("en-US");
}

export const THAI_MONTHS = [
  "",
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
