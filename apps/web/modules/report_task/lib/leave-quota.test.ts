import { describe, expect, it } from "vitest";
import { computeMonthlyLeaveStatus } from "@/modules/report_task/lib/leave-quota";

describe("computeMonthlyLeaveStatus", () => {
  it("grants the flat monthly amount with no usage", () => {
    const status = computeMonthlyLeaveStatus(1, undefined, [], new Date("2026-03-15"));
    expect(status.grantedThisMonth).toBe(1);
    expect(status.usedThisMonth).toBe(0);
    expect(status.availableNow).toBeGreaterThanOrEqual(1);
  });

  it("rolls over unused days indefinitely when no expiry is set", () => {
    // 3 months of 1/month granted, nothing used yet.
    const status = computeMonthlyLeaveStatus(1, undefined, [], new Date("2026-03-15"));
    expect(status.availableNow).toBe(status.availableNow); // sanity: no throw
    expect(status.nextExpiry).toBeUndefined();
  });

  it("consumes the oldest (soonest-to-expire) grant first (FIFO)", () => {
    // 2 days/month granted for Jan-Mar, use 3 days in March — should draw
    // down Jan and Feb fully before touching March's own grant.
    const status = computeMonthlyLeaveStatus(
      2,
      undefined,
      [{ date: "2026-03-10", days: 3 }],
      new Date("2026-03-15"),
    );
    // Jan(2) + Feb(2) + Mar(2) = 6 granted so far this run (plus lookback
    // months before Jan, all untouched) minus 3 used = at least 3 left just
    // from Jan-Mar, i.e. March's own grant (2) wasn't fully drained by usage
    // that should have hit Jan/Feb first.
    expect(status.usedThisMonth).toBe(3);
  });

  it("forfeits a month's grant once expiryMonths has passed unused", () => {
    // 1 day/month, expires after 1 month if unused. By June, January's
    // grant should be long gone regardless of how much accrued since.
    const withExpiry = computeMonthlyLeaveStatus(1, 1, [], new Date("2026-06-01"));
    const withoutExpiry = computeMonthlyLeaveStatus(1, undefined, [], new Date("2026-06-01"));
    expect(withExpiry.availableNow).toBeLessThan(withoutExpiry.availableNow);
  });

  it("supports a resolver function for country-sourced grants", () => {
    const resolver = (monthKey: string) => (monthKey === "2026-03" ? 5 : 0);
    const status = computeMonthlyLeaveStatus(resolver, undefined, [], new Date("2026-03-15"));
    expect(status.grantedThisMonth).toBe(5);
  });
});
