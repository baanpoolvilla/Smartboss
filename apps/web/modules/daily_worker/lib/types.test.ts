import { describe, expect, it } from "vitest";
import { daysInMonth, hoursLabel, minutesToHm, otMinutes, shiftMonth } from "./types";

describe("daily worker helpers", () => {
  it("OT hours come from the start–end the supervisor typed, crossing midnight too", () => {
    expect(otMinutes("17:00", "19:00")).toBe(120);
    expect(otMinutes("17:00", "18:30")).toBe(90);
    expect(otMinutes("22:00", "02:00")).toBe(240);
    expect(hoursLabel(120)).toBe("2 ชม.");
    expect(hoursLabel(90)).toBe("1.5 ชม.");
  });
  it("months and shift times", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-10")).toBe(31);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(minutesToHm(480)).toBe("08:00");
    expect(minutesToHm(1440 + 360)).toBe("06:00");
  });
});
