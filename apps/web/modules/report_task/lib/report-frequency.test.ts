import { describe, expect, it } from "vitest";
import { topicReportFrequency, withSimplifiedDailyRoundLabels } from "@/modules/report_task/lib/report-frequency";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";

function topic(overrides: Partial<ReportTopic>): ReportTopic {
  return {
    id: "t1",
    name: "some-room",
    color: "#000",
    createdAt: new Date().toISOString(),
    minImages: 0,
    cutoffs: [],
    ...overrides,
  } as ReportTopic;
}

describe("topicReportFrequency", () => {
  it("null for a room with no submission rounds at all (plain chat room)", () => {
    expect(topicReportFrequency(topic({}))).toBeNull();
  });

  it("daily for a room whose rounds run every day", () => {
    const t = topic({
      submissionRounds: [
        { id: "r1", label: "เช้า", time: "09:00", submitters: { mode: "everyone" } },
        { id: "r2", label: "เย็น", time: "18:00", submitters: { mode: "everyone" } },
      ],
    });
    expect(topicReportFrequency(t)).toBe("daily");
  });

  it("weekly for a room whose round only runs specific weekdays", () => {
    const t = topic({
      submissionRounds: [{ id: "r1", label: "รายสัปดาห์", time: "18:00", weekdays: [5], submitters: { mode: "everyone" } }],
    });
    expect(topicReportFrequency(t)).toBe("weekly");
  });

  it("monthly for a room whose round is keyed to a day-of-month", () => {
    const t = topic({
      submissionRounds: [{ id: "r1", label: "รายเดือน", time: "18:00", dayOfMonth: 30, submitters: { mode: "everyone" } }],
    });
    expect(topicReportFrequency(t)).toBe("monthly");
  });

  it("monthly wins even if another round on the same topic is daily/weekly", () => {
    const t = topic({
      submissionRounds: [
        { id: "r1", label: "เช้า", time: "09:00", submitters: { mode: "everyone" } },
        { id: "r2", label: "รายเดือน", time: "18:00", dayOfMonth: 30, submitters: { mode: "everyone" } },
      ],
    });
    expect(topicReportFrequency(t)).toBe("monthly");
  });

  it("derives from legacy cutoffs when submissionRounds hasn't been migrated yet", () => {
    const t = topic({
      cutoffs: [{ id: "c1", label: "Daily-report-Morning", time: "09:00" }],
      requiredWeekdays: [5],
    });
    expect(topicReportFrequency(t)).toBe("weekly");
  });
});

describe("withSimplifiedDailyRoundLabels", () => {
  it("relabels each round เช้า/เย็น by its cutoff hour, without touching the original topic", () => {
    const original = topic({
      submissionRounds: [
        { id: "r1", label: "Daily-report-Morning", time: "09:00", submitters: { mode: "everyone" } },
        { id: "r2", label: "Daily-report-Evening", time: "18:00", submitters: { mode: "everyone" } },
      ],
    });
    const simplified = withSimplifiedDailyRoundLabels(original);
    expect(simplified.submissionRounds?.map((r) => r.label)).toEqual(["เช้า", "เย็น"]);
    // original object (and the store's real data behind it) is untouched
    expect(original.submissionRounds?.map((r) => r.label)).toEqual(["Daily-report-Morning", "Daily-report-Evening"]);
  });

  it("returns the topic as-is when it has no rounds", () => {
    const t = topic({});
    expect(withSimplifiedDailyRoundLabels(t)).toBe(t);
  });
});
