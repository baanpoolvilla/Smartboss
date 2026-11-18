import { describe, expect, it } from "vitest";
import { correctedInBlocksOut } from "./corrected-in-guard";

const shift = { startMinutes: 8 * 60, endMinutes: 17 * 60, restDay: false };
const th = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00+07:00`);
const adjIn = { intent: "CLOCK_IN", capturedAt: th("08:11").toISOString(), sourceType: "ADJUSTMENT" };

describe("correctedInBlocksOut", () => {
  it("blocks a morning clock-out right after a corrected clock-in (GL-011 18 Nov)", () => {
    expect(correctedInBlocksOut([adjIn], shift, th("08:17"))).toEqual({ inAt: adjIn.capturedAt, untilMinutes: 750 });
  });

  it("allows clocking out after mid-shift", () => {
    expect(correctedInBlocksOut([adjIn], shift, th("12:31"))).toBeNull();
  });

  it("does not block when the last punch is a real scan", () => {
    const phoneIn = { intent: "CLOCK_IN", capturedAt: th("08:17").toISOString(), sourceType: "MOBILE" };
    expect(correctedInBlocksOut([adjIn, phoneIn], shift, th("08:20"))).toBeNull();
  });

  it("does not block a real clock-in without corrections", () => {
    const scan = { intent: "AUTO", capturedAt: th("08:00").toISOString(), sourceType: "DEVICE" };
    expect(correctedInBlocksOut([scan], shift, th("09:00"))).toBeNull();
  });

  it("does not block without a usable day shift", () => {
    expect(correctedInBlocksOut([adjIn], null, th("08:17"))).toBeNull();
    expect(correctedInBlocksOut([adjIn], { ...shift, restDay: true }, th("08:17"))).toBeNull();
    expect(correctedInBlocksOut([adjIn], { startMinutes: 22 * 60, endMinutes: 6 * 60, restDay: false }, th("08:17"))).toBeNull();
  });
});
