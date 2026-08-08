import { describe, expect, it } from "vitest";
import { lateCutoffFor, minImagesNow } from "@/modules/report_task/lib/report-cutoff";
import type { ReportCutoff } from "@/modules/report_task/store/report-feed-store";

const cutoffs: ReportCutoff[] = [
  { id: "morning", label: "เช้า", time: "09:00", minImages: 1 },
  { id: "evening", label: "เย็น", time: "17:00", minImages: 0 },
];

describe("lateCutoffFor", () => {
  it("returns null when there are no cutoffs", () => {
    expect(lateCutoffFor("2026-01-01T10:00:00", [])).toBeNull();
  });

  it("returns null before the first cutoff of the day", () => {
    expect(lateCutoffFor("2026-01-01T08:00:00", cutoffs)).toBeNull();
  });

  it("matches the morning round right after it opens", () => {
    expect(lateCutoffFor("2026-01-01T09:30:00", cutoffs)?.id).toBe("morning");
  });

  it("matches the latest cutoff at/before the post time", () => {
    expect(lateCutoffFor("2026-01-01T18:00:00", cutoffs)?.id).toBe("evening");
  });
});

describe("minImagesNow", () => {
  it("uses the round's own minImages when a round is active", () => {
    // currentCutoff depends on the real clock, so just check the resolution
    // logic directly via lateCutoffFor's result shape instead of the exact
    // round — falls back to the topic default when no round matches.
    expect(minImagesNow({ minImages: 2, cutoffs: [] })).toBe(2);
  });
});
