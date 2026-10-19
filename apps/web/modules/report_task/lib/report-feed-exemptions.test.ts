import { describe, expect, it } from "vitest";
import { buildDateExemptions, isExemptDate, isOtOnDayOff } from "@/modules/report_task/lib/report-feed-exemptions";
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

describe("approved OT on a day off = a working day (ผู้ใช้ขอ 19/10/2569)", () => {
  const ot = (date: string, next: string): CalendarEvent => ({ id: "ot1", title: "OT 8 ชม.", type: "ot", start: date, end: next, allDay: true, userId: "u1" });
  const holiday: CalendarEvent = { id: "h1", title: "วันหยุด", type: "holiday", start: "2026-10-17", end: "2026-10-18", allDay: true };

  it("Day-Off + approved OT → reports are due again", () => {
    const ex = buildDateExemptions([leave()], [], noRoutine, 3, false, [ot("2026-09-27", "2026-09-28")]);
    expect(isExemptDate(ex, "u1", "2026-09-27")).toBe(false);
    expect(isOtOnDayOff(ex, "u1", "2026-09-27")).toBe(true);
  });

  it("company holiday + approved OT → due for that person only", () => {
    const ex = buildDateExemptions([], [holiday], noRoutine, 3, false, [ot("2026-10-17", "2026-10-18")]);
    expect(isExemptDate(ex, "u1", "2026-10-17")).toBe(false);
    expect(isExemptDate(ex, "u2", "2026-10-17")).toBe(true);
  });

  it("OT on an ordinary working day changes nothing (no OT badge)", () => {
    const ex = buildDateExemptions([], [], noRoutine, 3, false, [ot("2026-10-14", "2026-10-15")]);
    expect(isExemptDate(ex, "u1", "2026-10-14")).toBe(false);
    expect(isOtOnDayOff(ex, "u1", "2026-10-14")).toBe(false);
  });
});
