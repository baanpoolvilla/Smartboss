import { describe, expect, it } from "vitest";
import { penaltyRequestOpen } from "@/modules/report_task/lib/penalty-request-window";
import { DEFAULT_SCORE_PERIOD } from "@/lib/score-period";

const th = (iso: string) => new Date(`${iso}+07:00`);
const cfg = DEFAULT_SCORE_PERIOD; // ตัดรอบวันที่ 25

describe("penaltyRequestOpen (cut off on the 25th)", () => {
  it("open for a deduction in the current period", () => {
    expect(penaltyRequestOpen("2026-10-20", th("2026-10-21T08:00:00"), cfg, th("2026-10-24T10:00:00"))).toBe(true);
  });
  it("closed once the period's cutoff (the 25th) has passed", () => {
    expect(penaltyRequestOpen("2026-10-20", th("2026-10-21T08:00:00"), cfg, th("2026-10-26T09:00:00"))).toBe(false);
  });
  it("the 26th already belongs to the next period", () => {
    expect(penaltyRequestOpen("2026-10-26", th("2026-10-27T08:00:00"), cfg, th("2026-11-20T09:00:00"))).toBe(true);
  });
  it("open when a cutoff-day miss was only recorded in the new period", () => {
    expect(penaltyRequestOpen("2026-10-25", th("2026-10-26T01:00:00"), cfg, th("2026-11-10T09:00:00"))).toBe(true);
  });
});
