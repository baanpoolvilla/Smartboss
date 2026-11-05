/** ประเภทการลาในช่องเลือกตอนลงวันหยุด — ใช้ร่วมกันทั้งปฏิทินทีม (HR) และปฏิทินของโมดูลรายงาน */
export interface LeaveTypeChoice {
  id: string;
  label: string;
  autoApprove: boolean;
  monthlyQuotaDays: number;
  /**
   * Holiday ที่ทบยอดได้: จำนวนวันที่ตัวเองยังลงได้ในเดือนนั้น — 0 = สิทธิ์หมด ไม่ขึ้นให้เลือก
   * null/ไม่มี = ประเภทนี้ไม่ได้คุมด้วยยอดสะสม
   */
  availableDays?: number | null;
  /** วันที่ตัวเองลงไปแล้วในเดือนนั้น (รออนุมัติ + อนุมัติแล้ว) — มีค่า = ขึ้น "ใช้ 4/6 วัน" แทน "6 วัน/เดือน" */
  usedDays?: number | null;
  /**
   * สิทธิ์รายคนรายปี (ลาพักร้อน) ของตัวเองในปีของวันที่เลือก — ได้/ใช้ (รวมรออนุมัติ)/เหลือ
   * null/ไม่มี = ประเภทนี้ไม่ได้คุมด้วยสิทธิ์รายปี
   */
  yearly?: YearlyEntitlement | null;
}

export interface YearlyEntitlement {
  entitled: number;
  used: number;
  available: number;
}

/** "1.5" ไม่ใช่ "1.50" · จำนวนเต็มไม่มีจุด */
export function fmtDays(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** สิทธิ์รายปีหมดแล้ว (หรือ HR ยังไม่ได้ให้) — ยังขึ้นในรายการให้เห็นว่าหมด แต่เลือกไม่ได้ */
export function leaveTypeDisabled(t: { yearly?: YearlyEntitlement | null }): boolean {
  return !!t.yearly && t.yearly.available <= 0;
}

/** เลือกวันเกินสิทธิ์รายปีที่เหลือ — คืนข้อความเตือน · ไม่เกิน/ไม่ได้คุมด้วยสิทธิ์รายปี = null */
export function yearlyOverMessage(t: { yearly?: YearlyEntitlement | null } | undefined, days: number): string | null {
  if (!t?.yearly || t.yearly.available <= 0 || days <= t.yearly.available) return null;
  return `เลือกไว้ ${days} วัน แต่สิทธิ์เหลือ ${fmtDays(t.yearly.available)} วัน — ลดจำนวนวันก่อน`;
}

/** ข้อความสิทธิ์รายปีของตัวเอง เช่น "ใช้ 3/10 วัน · เหลือ 7" — ใช้ทั้งในช่องเลือกและป้ายข้างชื่อเดือน */
export function yearlyText(y: YearlyEntitlement): string {
  if (y.entitled <= 0 && y.used <= 0) return "ยังไม่มีสิทธิ์ — ติดต่อ HR";
  if (y.available <= 0) return `หมดแล้ว · ใช้ ${fmtDays(y.used)}/${fmtDays(y.entitled)} วัน`;
  return `ใช้ ${fmtDays(y.used)}/${fmtDays(y.entitled)} วัน · เหลือ ${fmtDays(y.available)}`;
}

/** ประเภทที่ยังลงได้ — ตัด Holiday ที่สิทธิ์หมดแล้วออก (เซิร์ฟเวอร์ปฏิเสธอยู่แล้ว แต่ไม่ควรให้เลือกแล้วค่อยเด้ง) */
export function usableLeaveTypes<T extends { availableDays?: number | null; yearly?: YearlyEntitlement | null }>(types: T[]): T[] {
  // สิทธิ์รายปีหมด = ยังแสดง (บอกว่าหมด) แต่ไปไว้ท้ายรายการ ตัวที่ถูกเลือกไว้ก่อนจึงเป็นตัวที่ลงได้
  const usable = types.filter((t) => t.availableDays == null || t.availableDays > 0);
  return [...usable.filter((t) => !leaveTypeDisabled(t)), ...usable.filter((t) => leaveTypeDisabled(t))];
}

/** คำต่อท้ายชื่อประเภทในช่องเลือก — ต้องอนุมัติไหม และเหลือสิทธิ์เท่าไร */
export function leaveTypeHint(t: Pick<LeaveTypeChoice, "autoApprove" | "monthlyQuotaDays" | "availableDays" | "usedDays" | "yearly">): string {
  const left = t.yearly
    ? yearlyText(t.yearly)
    : t.availableDays != null
      ? `เหลือ ${t.availableDays} วัน`
      : t.autoApprove && t.monthlyQuotaDays > 0
        ? t.usedDays != null
          ? `ใช้ ${t.usedDays}/${t.monthlyQuotaDays} วัน`
          : `${t.monthlyQuotaDays} วัน/เดือน`
        : "";
  return `${t.autoApprove ? " — ไม่ต้องอนุมัติ" : " — ต้องรออนุมัติ"}${left ? ` (${left})` : ""}`;
}
