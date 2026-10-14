import { describe, expect, it } from "vitest";
import { penaltyRequestOpen } from "@/modules/report_task/lib/penalty-request-window";

const now = new Date("2026-11-03T04:00:00Z"); // 3 พ.ย. 11:00 เวลาไทย

describe("penaltyRequestOpen", () => {
  it("open for a deduction in the current month", () => {
    expect(penaltyRequestOpen("2026-11-02", "2026-11-02T03:00:00Z", now)).toBe(true);
  });
  it("closed once the month of the deduction is over", () => {
    expect(penaltyRequestOpen("2026-10-13", "2026-10-14T03:00:00Z", now)).toBe(false);
  });
  it("open when a last-day miss was only recorded this month", () => {
    expect(penaltyRequestOpen("2026-10-31", "2026-11-01T01:00:00Z", now)).toBe(true);
  });
  it("uses Thai time at the month boundary", () => {
    // 31 ต.ค. 23:30 UTC = 1 พ.ย. 06:30 เวลาไทย
    expect(penaltyRequestOpen("2026-11-01", null, new Date("2026-10-31T23:30:00Z"))).toBe(true);
  });
});
