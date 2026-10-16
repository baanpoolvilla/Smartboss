import type { SubmissionRound } from "@/modules/report_task/store/report-feed-store";

/**
 * ช่วงที่ระบบล่ม — รอบรายงานที่กำหนดส่งตกในช่วงนี้ไม่มีใครส่งได้จริง จึงไม่นับเป็น "ไม่ส่ง/สาย"
 * ทั้งบนแดชบอร์ด (report-feed-compliance.ts) และตอนหักคะแนน (report-penalty-sweep.ts)
 * ส่งมาแล้วก็นับว่าส่งตรงเวลา (โพสต์ทีหลังตอนระบบกลับมา ไม่ควรขึ้นว่าสาย)
 *
 * เวลาเป็นเวลาไทย "YYYY-MM-DDTHH:mm" · from รวม, to ไม่รวม
 */
export const REPORT_OUTAGE_WINDOWS: { from: string; to: string; note: string }[] = [
  // เซิร์ฟเวอร์ล่ม (ยังไม่ผูกบัตร) — สแกนสุดท้าย 15/10 17:01 · กลับมา 16/10 13:40
  { from: "2026-10-15T17:00", to: "2026-10-16T14:00", note: "เซิร์ฟเวอร์ล่ม 15–16 ต.ค. 2569" },
];

/** รอบนี้ของวันนี้ กำหนดส่งตกช่วงระบบล่มไหม */
export function roundInOutage(round: Pick<SubmissionRound, "time">, day: string): boolean {
  const at = `${day}T${round.time}`;
  return REPORT_OUTAGE_WINDOWS.some((w) => at >= w.from && at < w.to);
}
