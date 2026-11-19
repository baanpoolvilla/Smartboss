/**
 * Holiday แบบสะสม: สิทธิ์ของแต่ละเดือนใช้ได้กี่เดือน (leave_types.holiday_valid_months · ผู้ใช้ 19/11/2569)
 * ข้อความเดียวกันทุกหน้า — ค่าไม่มี/เพี้ยน = 3 เหมือนก่อนมีตั้งค่า
 */
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function holidayValidMonths(value: number | null | undefined): number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12 ? (value as number) : 3;
}

/** "ใช้ได้ภายใน 3 เดือนนับรวมเดือนที่ได้ (เช่น ของ ก.ค. ใช้ได้ถึงสิ้น ก.ย.)" */
export function holidayValidityText(value: number | null | undefined): string {
  const n = holidayValidMonths(value);
  if (n === 1) return "ใช้ได้เฉพาะในเดือนที่ได้ (เช่น ของ ก.ค. ใช้ได้ถึงสิ้น ก.ค.)";
  return `ใช้ได้ภายใน ${n} เดือนนับรวมเดือนที่ได้ (เช่น ของ ก.ค. ใช้ได้ถึงสิ้น ${TH_MONTHS[(6 + n - 1) % 12]})`;
}
