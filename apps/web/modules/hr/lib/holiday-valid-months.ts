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

/** ตัดตามรอบปี (leave_types.holiday_year_carry_months · ผู้ใช้ 19/11/2569) — 0–11 · ไม่มี/เพี้ยน = null (ไม่ตัด) */
export function holidayYearCarry(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 11 ? (value as number) : null;
}

const TH_MONTHS_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** ชื่อตัวเลือกในช่องตั้งค่า: 0 → "สิ้น ธ.ค. ของปีนั้น (ไม่ข้ามปี)" · 1 → "สิ้น ม.ค. ของปีถัดไป" */
export function yearCarryOptionLabel(carry: number): string {
  return carry === 0 ? "สิ้นธันวาคมของปีนั้น (ไม่ข้ามปี)" : `สิ้น${TH_MONTHS_FULL[carry - 1]}ของปีถัดไป`;
}

/**
 * ประโยคกติกาสำหรับคนอ่าน — ใส่ปีจริงให้เห็นภาพ (ปี พ.ศ.)
 * 1, 2569 → "สิทธิ์ของปี 2569 ใช้ได้ถึงสิ้นมกราคม 2570 เท่านั้น หลังจากนั้นตัดทิ้งทั้งหมด"
 */
export function yearCarryRuleText(value: number | null | undefined, beYear: number): string | null {
  const carry = holidayYearCarry(value);
  if (carry === null) return null;
  if (carry === 0) return `สิทธิ์ของปี ${beYear} ต้องใช้ภายในธันวาคม ${beYear} ไม่ทบข้ามปี`;
  return `สิทธิ์ของปี ${beYear} ใช้ข้ามปีได้ถึงสิ้น${TH_MONTHS_FULL[carry - 1]} ${beYear + 1} เท่านั้น หลังจากนั้นตัดทิ้งทั้งหมด`;
}

/** ครบ N เดือนแล้วสิทธิ์ของเดือนนี้ควรหมดเดือนไหน ("YYYY-MM") — ใช้ดูว่าโดนตัดตามรอบปีก่อนหรือไม่ */
export function naturalExpiryMonth(month: string, validMonths: number): string {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + holidayValidMonths(validMonths) - 1;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
