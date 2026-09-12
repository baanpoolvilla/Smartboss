/**
 * ตัวช่วยเรื่อง "เดือนปฏิทิน" ของหน้าผลงานรายคน — แยกออกมาจาก page.tsx เพราะ
 * หน้ารายละเอียดรายคน (/admin/performance/[userId]) ต้องคำนวณเดือนแบบเดียวกัน
 * เป๊ะ ๆ ไม่งั้นตัวเลขที่เห็นในหน้าสรุปกับหน้ารายละเอียดจะไม่ตรงกัน
 */

const THAI_MONTH = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y!, m! - 1 + delta, 1)));
}

/** ขอบเขตวันของเดือนปฏิทินนั้น — ใช้ UTC ตรงๆ กันเดือนเลื่อนจาก timezone */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y!, m! - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y!, m!, 1, 0, 0, 0) - 1);
  return { from, to };
}

export function monthDisplay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${THAI_MONTH[m! - 1]} ${y! + 543}`;
}

/** เดือนจาก query param ปลอดภัยไหม — ผิดรูปแบบ/เดือนอนาคตตกกลับมาเป็นเดือนนี้เงียบๆ */
export function resolveMonthParam(monthParam: string | undefined): string {
  const thisRealMonth = monthKey(new Date());
  return monthParam !== undefined &&
    /^\d{4}-\d{2}$/.test(monthParam) &&
    monthParam <= thisRealMonth
    ? monthParam
    : thisRealMonth;
}
