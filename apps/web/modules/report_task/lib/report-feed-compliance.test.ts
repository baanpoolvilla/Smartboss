import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayComplianceStatus, roundComplianceStatus } from "@/modules/report_task/lib/report-feed-compliance";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import { users } from "@/modules/report_task/lib/directory";
import type { ReportPost, ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";

const userId = "test-user-rounds";
const otherUserId = "test-user-someone-else";

const morning: SubmissionRound = {
  id: "r9",
  label: "รอบ 9 โมง",
  time: "09:00",
  submitters: { mode: "people", userIds: [userId] },
};
const noon: SubmissionRound = {
  id: "r11",
  label: "รอบ 11 โมง",
  time: "11:00",
  submitters: { mode: "people", userIds: [userId] },
};

function topicWith(rounds: SubmissionRound[]): ReportTopic {
  return {
    id: "t1",
    name: "test",
    color: "#000",
    createdAt: new Date(2026, 0, 1).toISOString(),
    minImages: 0,
    cutoffs: [],
    submissionRounds: rounds,
  };
}

function postAt(local: Date, roundId?: string, authorId: string = userId): ReportPost {
  return {
    id: `p-${local.getTime()}`,
    topicId: "t1",
    authorId,
    createdAt: local.toISOString(),
    editedAt: null,
    pinned: false,
    savedBy: [],
    unreadFor: [],
    reactions: {},
    replies: [],
    title: "x",
    sections: [],
    images: [],
    tagIds: [],
    roundId,
  };
}

const today = "2026-02-02"; // localDateStr of the fake "now" below

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 1, 2, 12, 0, 0)); // noon — past both rounds' cutoffs
});

afterEach(() => {
  vi.useRealTimers();
});

describe("roundComplianceStatus — two-round room, table from spec §0", () => {
  const topic = topicWith([morning, noon]);

  it("08:30 for รอบ 9:00 → on-time", () => {
    const posts = [postAt(new Date(2026, 1, 2, 8, 30), "r9")];
    expect(roundComplianceStatus(topic, userId, morning, today, posts)).toBe("on-time");
  });

  it("10:12 explicitly filed under รอบ 9:00 → late (ส่งย้อนหลัง)", () => {
    const posts = [postAt(new Date(2026, 1, 2, 10, 12), "r9")];
    expect(roundComplianceStatus(topic, userId, morning, today, posts)).toBe("late");
  });

  it("10:55 filed under รอบ 11:00 → on-time, independent of รอบ 9 above", () => {
    const posts = [postAt(new Date(2026, 1, 2, 10, 55), "r11")];
    expect(roundComplianceStatus(topic, userId, noon, today, posts)).toBe("on-time");
  });

  it("no post at all for รอบ 9:00 → missed, once its cutoff has passed", () => {
    expect(roundComplianceStatus(topic, userId, morning, today, [])).toBe("missed");
  });

  it("รอบ 11:00 with no post yet, before its own cutoff → pending, independent of รอบ 9 already being missed", () => {
    vi.setSystemTime(new Date(2026, 1, 2, 10, 0, 0)); // before 11:00, after 09:00
    expect(roundComplianceStatus(topic, userId, morning, today, [])).toBe("missed");
    expect(roundComplianceStatus(topic, userId, noon, today, [])).toBe("pending");
  });

  it("a round this user isn't a submitter of → exempt", () => {
    const othersOnly: SubmissionRound = { ...morning, id: "r9-others", submitters: { mode: "people", userIds: [otherUserId] } };
    expect(roundComplianceStatus(topic, userId, othersOnly, today, [])).toBe("exempt");
  });

  it("a round that doesn't run on this weekday → exempt", () => {
    const notToday = (new Date(2026, 1, 2).getDay() + 1) % 7;
    const weekdayLocked: SubmissionRound = { ...morning, weekdays: [notToday] };
    expect(roundComplianceStatus(topic, userId, weekdayLocked, today, [])).toBe("exempt");
  });
});

describe("roundComplianceStatus — legacy single-cutoff room matches dayComplianceStatus", () => {
  const legacyTopic: ReportTopic = {
    id: "t-legacy",
    name: "legacy",
    color: "#000",
    createdAt: new Date(2026, 0, 1).toISOString(),
    minImages: 0,
    cutoffs: [{ id: "c1", label: "เดิม", time: "09:00" }],
  };
  const [onlyRound] = effectiveRoundsOf(legacyTopic);
  // A legacy room's synthesized round uses submitters = "everyone who can
  // see the room" (see effectiveRoundsOf), so — unlike the "people"-mode
  // rounds above — this equivalence check needs a real directory user, not
  // an arbitrary test id, or resolveRoundSubmitters would exempt them.
  const legacyUserId = users[0]!.id;

  it("effectiveRoundsOf synthesizes exactly one round from the one legacy cutoff", () => {
    expect(effectiveRoundsOf(legacyTopic)).toHaveLength(1);
  });

  it.each([
    ["on-time post", [postAt(new Date(2026, 1, 2, 8, 0), undefined, legacyUserId)]],
    ["late post", [postAt(new Date(2026, 1, 2, 10, 0), undefined, legacyUserId)]],
    ["no post (missed)", []],
  ])("%s: roundComplianceStatus agrees with dayComplianceStatus", (_label, posts) => {
    expect(roundComplianceStatus(legacyTopic, legacyUserId, onlyRound!, today, posts)).toBe(
      dayComplianceStatus(legacyTopic, legacyUserId, today, posts)
    );
  });
});
