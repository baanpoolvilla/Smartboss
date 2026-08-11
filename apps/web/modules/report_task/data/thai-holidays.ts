import type { CalendarEvent } from "@/modules/report_task/types";

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
// FullCalendar's all-day end date is exclusive, so end = the day after.
const nextYmd = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

// Fixed-date national holidays — same Gregorian date every year.
const fixedHolidayDefs: { month: number; day: number; title: string }[] = [
  { month: 1, day: 1, title: "วันขึ้นปีใหม่" },
  { month: 4, day: 6, title: "วันจักรี" },
  { month: 5, day: 1, title: "วันแรงงานแห่งชาติ" },
  { month: 5, day: 4, title: "วันฉัตรมงคล" },
  { month: 6, day: 3, title: "วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี" },
  { month: 7, day: 28, title: "วันเฉลิมพระชนมพรรษา ร.10" },
  { month: 8, day: 12, title: "วันแม่แห่งชาติ (วันเฉลิมพระชนมพรรษาพระบรมราชชนนีพันปีหลวง)" },
  { month: 10, day: 13, title: "วันคล้ายวันสวรรคต ร.9" },
  { month: 10, day: 23, title: "วันปิยมหาราช" },
  { month: 12, day: 5, title: "วันพ่อแห่งชาติ (วันชาติ)" },
  { month: 12, day: 10, title: "วันรัฐธรรมนูญ" },
  { month: 12, day: 31, title: "วันสิ้นปี" },
];

// Buddhist holidays follow the lunar calendar and shift each year, so they are
// only listed for years with officially published dates (extend as announced).
const lunarHolidaysByYear: Record<number, { start: string; end: string; title: string }[]> = {
  2026: [
    { start: "2026-03-03", end: "2026-03-04", title: "วันมาฆบูชา" },
    { start: "2026-05-31", end: "2026-06-01", title: "วันวิสาขบูชา" },
    { start: "2026-07-29", end: "2026-07-30", title: "วันอาสาฬหบูชา" },
    { start: "2026-07-30", end: "2026-07-31", title: "วันเข้าพรรษา" },
  ],
};

const HOLIDAY_YEARS = Array.from({ length: 11 }, (_, i) => 2026 + i); // 2026–2036

export const thaiHolidayEvents: CalendarEvent[] = HOLIDAY_YEARS.flatMap((year) => {
  const list: CalendarEvent[] = fixedHolidayDefs.map((h, i) => ({
    id: `hol-${year}-f${i}`,
    title: h.title,
    type: "holiday",
    start: ymd(year, h.month, h.day),
    end: nextYmd(year, h.month, h.day),
    allDay: true,
  }));

  // Songkran spans 13–15 April.
  list.push({
    id: `hol-${year}-songkran`,
    title: "วันสงกรานต์",
    type: "holiday",
    start: ymd(year, 4, 13),
    end: ymd(year, 4, 16),
    allDay: true,
  });

  (lunarHolidaysByYear[year] ?? []).forEach((h, i) => {
    list.push({
      id: `hol-${year}-l${i}`,
      title: h.title,
      type: "holiday",
      start: h.start,
      end: h.end,
      allDay: true,
    });
  });

  return list;
});
