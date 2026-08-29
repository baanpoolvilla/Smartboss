const THAI_MONTHS_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** Report-feed's own day-separator wording only — turns dayLabelFor's
 * "วันนี้ · 17/08/2026" (numeric dd/mm/yyyy, the app-wide format every other
 * date in report_task deliberately keeps — see lib/format.ts's own
 * docstring on why) into "วันนี้ · 17 ส.ค. 2569" for this feed's separators
 * specifically, without touching that shared formatter or its other
 * callers (calendar, activity log, openchat's own history, ...). */
export function reportDayLabel(label: string): string {
  const match = label.match(/(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return label;
  const [full, dd, mm, yyyy] = match;
  const monthName = THAI_MONTHS_ABBR[Number(mm) - 1];
  if (!monthName) return label;
  const buddhistYear = Number(yyyy) + 543;
  return `${label.slice(0, label.length - full.length)}${Number(dd)} ${monthName} ${buddhistYear}`;
}
