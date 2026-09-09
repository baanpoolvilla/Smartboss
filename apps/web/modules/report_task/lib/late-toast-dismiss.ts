/**
 * "ไม่ต้องแสดงอีก (รอบนี้/วันนี้)" — เก็บแค่ต่อ topic+วันที่+roundId ตัวเดียว
 * ไม่ใช่ทั้งแอป พรุ่งนี้หรือรอบถัดไปกลับมาเตือนได้ใหม่โดยไม่ต้องเคลียร์อะไรเอง
 * (คีย์เก่าแค่ค้างเฉยๆ ไม่มีผลอะไรอีกต่อไป — ไม่คุ้มเขียน cleanup job มาล้าง)
 *
 * ย้ายมาจาก report-composer.tsx เดิม (เตือนตอนขยายกล่องเขียนโพสต์) มาไว้ที่
 * เดียวที่ทั้งฝั่งเดิมและตัวเตือนระดับหน้า (report-feed/page.tsx — เตือนทันที
 * ที่เข้าหน้ารายงาน "อยากให้กดหน้ารายงานมาแล้วแจ้งเตือนแบบนี้แทน") ใช้ร่วมกัน
 * ได้ กันสองจุดนี้แยกกันจำ "ปิดไปแล้ว" คนละชุด
 */
export function lateToastDismissKey(topicId: string, dateStr: string, roundId: string): string {
  return `report-late-toast-dismissed:${topicId}:${dateStr}:${roundId}`;
}

export function isLateToastDismissed(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function dismissLateToast(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // private mode ฯลฯ — แค่จะกลับมาเตือนอีกครั้งตอนเปิดใหม่ ไม่ร้ายแรง
  }
}
