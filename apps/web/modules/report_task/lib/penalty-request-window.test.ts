import { describe, expect, it } from "vitest";
import { penaltyRequestOpen } from "@/modules/report_task/lib/penalty-request-window";
import { DEFAULT_SCORE_PERIOD } from "@/lib/score-period";

const th = (iso: string) => new Date(`${iso}+07:00`);
const cfg = DEFAULT_SCORE_PERIOD; // ตัดรอบวันที่ 25

describe("penaltyRequestOpen (locks 23:59 on the 25th)", () => {
  it("open until 23:59 on the cutoff day", () => {
    expect(penaltyRequestOpen("2026-11-20", cfg, th("2026-11-25T23:58:00"))).toBe(true);
  });
  it("closed from 00:00 on the 26th", () => {
    expect(penaltyRequestOpen("2026-11-20", cfg, th("2026-11-26T00:00:00"))).toBe(false);
    expect(penaltyRequestOpen("2026-11-25", cfg, th("2026-11-26T08:30:00"))).toBe(false);
  });
  it("the 26th belongs to the next period, still open", () => {
    expect(penaltyRequestOpen("2026-11-26", cfg, th("2026-12-10T09:00:00"))).toBe(true);
  });
});
