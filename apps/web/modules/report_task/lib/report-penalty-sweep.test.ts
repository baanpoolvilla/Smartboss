import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeReportPenaltyCandidates,
  resolveRoundSubmittersServer,
  roundComplianceStatusServer,
} from "@/modules/report_task/lib/report-penalty-sweep";
import type { DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
import type { DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import type { ReportPost, ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";

const userId = "usr-a";
const otherUserId = "usr-b";

const users: DirectoryUser[] = [
  { id: userId, name: "A", email: "a@test.com", avatar: "A", avatarUrl: null, role: "staff", departmentId: "dep-1" },
  { id: otherUserId, name: "B", email: "b@test.com", avatar: "B", avatarUrl: null, role: "staff", departmentId: "dep-1" },
];

const noExemptions: DateExemptions = { personalDates: new Map(), companyDates: new Set() };

const morning: SubmissionRound = {
  id: "r9",
  label: "รอบ 9 โมง",
  time: "09:00",
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

function postAt(local: Date, roundId: string | undefined, authorId: string): ReportPost {
  return {
    id: `p-${local.getTime()}-${authorId}`,
    topicId: "t1",
    authorId,
    createdAt: local.toISOString(),
    editedAt: null,
    pinned: false,
    savedBy: [],
    unreadFor: [],
    reactions: {},
    stickerReactions: [],
    replies: [],
    title: "x",
    sections: [],
    images: [],
    tagIds: [],
    roundId,
  };
}

const today = "2026-02-02";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 1, 2, 12, 0, 0)); // noon — past the 09:00 cutoff
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveRoundSubmittersServer", () => {
  it("everyone mode resolves against the passed-in users, not a global list", () => {
    const round: SubmissionRound = { ...morning, submitters: { mode: "everyone" } };
    expect(resolveRoundSubmittersServer(round, undefined, [], users).sort()).toEqual([userId, otherUserId].sort());
  });

  it("owner is never a submitter even in everyone mode", () => {
    const withOwner: DirectoryUser[] = [...users, { id: "usr-owner", name: "Owner", email: "o@test.com", avatar: "O", avatarUrl: null, role: "owner", departmentId: "dep-1", isOwner: true }];
    const round: SubmissionRound = { ...morning, submitters: { mode: "everyone" } };
    expect(resolveRoundSubmittersServer(round, undefined, [], withOwner)).not.toContain("usr-owner");
  });

  it("people mode with removeUserIds drops that person", () => {
    const round: SubmissionRound = { ...morning, submitters: { mode: "people", userIds: [userId, otherUserId], removeUserIds: [otherUserId] } };
    expect(resolveRoundSubmittersServer(round, undefined, [], users)).toEqual([userId]);
  });
});

describe("roundComplianceStatusServer", () => {
  const topic = topicWith([morning]);

  it("posted before cutoff → on-time", () => {
    const posts = [postAt(new Date(2026, 1, 2, 8, 30), "r9", userId)];
    expect(roundComplianceStatusServer(topic, userId, morning, today, posts, [], users, noExemptions)).toBe("on-time");
  });

  it("no post, cutoff passed → missed", () => {
    expect(roundComplianceStatusServer(topic, userId, morning, today, [], [], users, noExemptions)).toBe("missed");
  });

  it("day on an exempt date (leave) → exempt, never missed", () => {
    const exemptions: DateExemptions = { personalDates: new Map([[userId, new Set([today])]]), companyDates: new Set() };
    expect(roundComplianceStatusServer(topic, userId, morning, today, [], [], users, exemptions)).toBe("exempt");
  });

  it("someone not in the round's submitters → exempt", () => {
    expect(roundComplianceStatusServer(topic, otherUserId, morning, today, [], [], users, noExemptions)).toBe("exempt");
  });
});

describe("computeReportPenaltyCandidates", () => {
  // lookbackDays: 0 — the room existed since Jan 1 and runs every day, so a
  // wider lookback would also (correctly) surface earlier missed days; these
  // three tests only care about today's single round, so they pin the walk
  // to just today to isolate that. notBeforeDay is set far in the past
  // (well before the room existed) so it never becomes the binding floor here.
  const noFloor = "2026-01-01";

  it("produces one missed candidate for a user who never posted, with the spec's refId shape", () => {
    const topic = topicWith([morning]);
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, 0, noFloor);
    const mine = candidates.filter((c) => c.userId === userId);
    expect(mine).toEqual([
      { userId, topicId: "t1", roundId: "r9", day: today, refId: `${today}:t1:r9:${userId}`, status: "missed" },
    ]);
  });

  it("an on-time post produces no candidate at all", () => {
    const topic = topicWith([morning]);
    const posts = [postAt(new Date(2026, 1, 2, 8, 30), "r9", userId)];
    const candidates = computeReportPenaltyCandidates([topic], posts, users, [], noExemptions, 0, noFloor);
    expect(candidates.filter((c) => c.userId === userId)).toEqual([]);
  });

  it("a late post produces a late candidate, not missed", () => {
    const topic = topicWith([morning]);
    const posts = [postAt(new Date(2026, 1, 2, 10, 0), "r9", userId)];
    const candidates = computeReportPenaltyCandidates([topic], posts, users, [], noExemptions, 0, noFloor);
    expect(candidates.filter((c) => c.userId === userId).map((c) => c.status)).toEqual(["late"]);
  });

  it("a room with no rounds at all (untracked) never produces a candidate", () => {
    const untracked: ReportTopic = { id: "t2", name: "untracked", color: "#000", createdAt: new Date(2026, 0, 1).toISOString(), minImages: 0, cutoffs: [] };
    const candidates = computeReportPenaltyCandidates([untracked], [], users, [], noExemptions, 5, noFloor);
    expect(candidates).toEqual([]);
  });

  // Regression test for the real production bug: turning the feature on for
  // the first time must never backfill days from before that moment, no
  // matter how wide lookbackDays is — notBeforeDay is the real floor.
  it("notBeforeDay blocks backfill even with a wide lookback — the day the feature was turned on wins over lookbackDays", () => {
    const topic = topicWith([morning]); // room existed since Jan 1, runs every day, never posted
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, 45, today);
    const mine = candidates.filter((c) => c.userId === userId);
    expect(mine).toEqual([
      { userId, topicId: "t1", roundId: "r9", day: today, refId: `${today}:t1:r9:${userId}`, status: "missed" },
    ]);
  });
});
