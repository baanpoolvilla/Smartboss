export type NotifRange = "today" | "7d" | "month" | "all";

// Asia/Bangkok is a fixed UTC+7 with no DST — a plain offset is enough,
// no need to reach for Intl.DateTimeFormat's timezone machinery for this.
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bkkShifted(d: Date): Date {
  return new Date(d.getTime() + BKK_OFFSET_MS);
}

/** "YYYY-MM-DD" ของวันที่นั้นตามเวลาไทย (ใช้เทียบวัน ไม่ใช่ค่าจริงของ UTC) */
function bkkDateKey(iso: string): string {
  return bkkShifted(new Date(iso)).toISOString().slice(0, 10);
}

/** "YYYY-MM" ของเดือนนั้นตามเวลาไทย */
function bkkMonthKey(iso: string): string {
  return bkkShifted(new Date(iso)).toISOString().slice(0, 7);
}

export function matchesRange(createdAtIso: string, range: NotifRange, now: Date = new Date()): boolean {
  if (range === "all") return true;
  if (range === "today") return bkkDateKey(createdAtIso) === bkkDateKey(now.toISOString());
  if (range === "month") return bkkMonthKey(createdAtIso) === bkkMonthKey(now.toISOString());
  // "7d" — a rolling window, not a calendar boundary, so plain elapsed time
  // is correct regardless of timezone.
  return now.getTime() - new Date(createdAtIso).getTime() <= 7 * 24 * 60 * 60 * 1000;
}

export const RANGE_LABEL: Record<NotifRange, string> = {
  today: "วันนี้",
  "7d": "7 วันล่าสุด",
  month: "เดือนนี้",
  all: "ทั้งหมด",
};
