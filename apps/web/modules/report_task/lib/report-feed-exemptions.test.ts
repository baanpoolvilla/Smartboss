import { describe, expect, it } from "vitest";
import { buildDateExemptions, isExemptDate } from "@/modules/report_task/lib/report-feed-exemptions";
import type { CalendarEvent } from "@/modules/report_task/types";

const noRoutine = { pickedDates: {}, rules: [], ruleExceptions: {} };

function leave(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: "l1", title: "Day-Off", type: "dayoff", start: "2026-09-27", end: "2026-09-28", allDay: true, userId: "u1", ...overrides };
}

describe("buildDateExemptions", () => {
  it("exempts reports on an ordinary leave / day-off", () => {
    const ex = buildDateExemptions([leave()], [], noRoutine);
    expect(isExemptDate(ex, "u1", "2026-09-27")).toBe(true);
    expect(isExemptDate(ex, "u1", "2026-09-28")).toBe(false);
  });

  it("does not exempt reports on a Work From Home day (requiresReports)", () => {
    const ex = buildDateExemptions([leave({ type: "leave", title: "Work From Home", requiresReports: true })], [], noRoutine);
    expect(isExemptDate(ex, "u1", "2026-09-27")).toBe(false);
  });

  it("exempts everyone on a public holiday, unless holidays are converted into Holiday leave credit", () => {
    const holiday: CalendarEvent = { id: "hol-2026-10-13", title: "วันนวมินทรมหาราช", type: "holiday", start: "2026-10-13", end: "2026-10-14", allDay: true };
    expect(isExemptDate(buildDateExemptions([], [holiday], noRoutine), "u1", "2026-10-13")).toBe(true);

    const later: CalendarEvent = { ...holiday, id: "hol-2026-10-23", start: "2026-10-23", end: "2026-10-24" };
    const credit = buildDateExemptions([leave({ title: "Holiday", start: "2026-10-20", end: "2026-10-21" })], [holiday, later], noRoutine, 3, true);
    expect(isExemptDate(credit, "u1", "2026-10-23")).toBe(false);
    expect(isExemptDate(credit, "u1", "2026-10-20")).toBe(true);
    // 13/10 อยู่ก่อนเปลี่ยนกติกา: ไม่นับว่าไม่ส่ง แต่โพสต์ที่ส่งมายังขึ้นป้ายรอบ
    expect(isExemptDate(credit, "u1", "2026-10-13")).toBe(true);
    expect(isExemptDate(credit, "u1", "2026-10-13", { ignoreLegacyHolidays: true })).toBe(false);
  });
});
