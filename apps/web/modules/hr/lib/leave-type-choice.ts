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
}

/** ประเภทที่ยังลงได้ — ตัด Holiday ที่สิทธิ์หมดแล้วออก (เซิร์ฟเวอร์ปฏิเสธอยู่แล้ว แต่ไม่ควรให้เลือกแล้วค่อยเด้ง) */
export function usableLeaveTypes<T extends { availableDays?: number | null }>(types: T[]): T[] {
  return types.filter((t) => t.availableDays == null || t.availableDays > 0);
}

/** คำต่อท้ายชื่อประเภทในช่องเลือก — ต้องอนุมัติไหม และเหลือสิทธิ์เท่าไร */
export function leaveTypeHint(t: Pick<LeaveTypeChoice, "autoApprove" | "monthlyQuotaDays" | "availableDays">): string {
  const left =
    t.availableDays != null
      ? `เหลือ ${t.availableDays} วัน`
      : t.autoApprove && t.monthlyQuotaDays > 0
        ? `${t.monthlyQuotaDays} วัน/เดือน`
        : "";
  return `${t.autoApprove ? " — ไม่ต้องอนุมัติ" : " — ต้องรออนุมัติ"}${left ? ` (${left})` : ""}`;
}
