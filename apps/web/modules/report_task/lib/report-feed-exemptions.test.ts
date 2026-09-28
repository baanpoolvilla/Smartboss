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
});
