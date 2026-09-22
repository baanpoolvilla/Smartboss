import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeReportPenaltyCandidates,
  resolveRoundSubmittersServer,
  roundComplianceStatusServer,
} from "@/modules/report_task/lib/report-penalty-sweep";
import type { DirectoryUser } from "@/modules/report_task/lib/db/employee-directory";
import type { DateExemptions } from "@/modules/report_task/lib/report-feed-exemptions";
import type { ReportPost, ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";
import type { ReportSubmissionLockSettings } from "@/modules/report_task/store/reminder-settings-store";

const userId = "usr-a";
const otherUserId = "usr-b";

const users: DirectoryUser[] = [
  { id: userId, name: "A", email: "a@test.com", avatar: "A", avatarUrl: null, role: "staff", departmentId: "dep-1" },
  { id: otherUserId, name: "B", email: "b@test.com", avatar: "B", avatarUrl: null, role: "staff", departmentId: "dep-1" },
];

const noExemptions: DateExemptions = { personalDates: new Map(), companyDates: new Set() };
// ไม่เปิด "ปิดรับรวมทุกห้อง" ระดับบริษัท — แต่ละห้องใช้ hardCutoffTime ของตัวเอง (ถ้าตั้งไว้)
const noGlobalLock: ReportSubmissionLockSettings = { useGlobalCutoff: false, time: "23:59" };

const morning: SubmissionRound = {
  id: "r9",
  label: "รอบ 9 โมง",
  time: "09:00",
  submitters: { mode: "people", userIds: [userId] },
};

function topicWith(rounds: SubmissionRound[], hardCutoffTime?: string): ReportTopic {
  return {
    id: "t1",
    name: "test",
    color: "#000",
    createdAt: new Date(2026, 0, 1).toISOString(),
    minImages: 0,
    cutoffs: [],
    submissionRounds: rounds,
    hardCutoffTime,
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
  // fake "now" is noon — past the round's own 09:00 cutoff either way
  const topicNoHardCutoff = topicWith([morning]); // ห้องไม่ตั้ง "เวลาปิดรับอัตโนมัติ" เลย
  const topicHardCutoffPassed = topicWith([morning], "10:00"); // ปิดรับจริงไปแล้วตั้งแต่ 10 โมง
  const topicHardCutoffAhead = topicWith([morning], "18:00"); // ยังไม่ปิดรับจนกว่าจะถึง 18:00

  it("posted before cutoff → on-time", () => {
    const posts = [postAt(new Date(2026, 1, 2, 8, 30), "r9", userId)];
    expect(roundComplianceStatusServer(topicNoHardCutoff, userId, morning, today, posts, [], users, noExemptions, noGlobalLock, 0)).toBe("on-time");
  });

  // เดิม (ก่อนแก้บั๊กนี้) โค้ดตัดสิน "missed" ทันทีที่เลยเวลารอบส่ง (09:00) โดย
  // ไม่สนใจว่าห้องยังเปิดรับส่งช้าอยู่จนถึงเมื่อไหร่ — คนที่ยังมีเวลาส่งเหลือ
  // อีกหลายชั่วโมงก็โดนหักเหมือนพลาดไปแล้วอย่างไม่เป็นธรรม (เจอจริงจากการใช้งาน)
  it("past round time but no hard cutoff configured at all → late, not missed (still open all day)", () => {
    expect(roundComplianceStatusServer(topicNoHardCutoff, userId, morning, today, [], [], users, noExemptions, noGlobalLock, 0)).toBe("late");
  });

  it("past round time but still before the room's hard cutoff → late, not missed (grace period)", () => {
    expect(roundComplianceStatusServer(topicHardCutoffAhead, userId, morning, today, [], [], users, noExemptions, noGlobalLock, 0)).toBe("late");
  });

  it("past round time AND past the room's hard cutoff, still no post → missed", () => {
    expect(roundComplianceStatusServer(topicHardCutoffPassed, userId, morning, today, [], [], users, noExemptions, noGlobalLock, 0)).toBe("missed");
  });

  it("company-wide global cutoff overrides the room's own hard cutoff", () => {
    const globalLockPassed: ReportSubmissionLockSettings = { useGlobalCutoff: true, time: "10:00" };
    // ห้องตั้งของตัวเองไว้ 18:00 (ยังไม่ปิด) แต่บริษัทเปิด "ปิดรับรวม" ไว้ 10:00 (ปิดแล้ว) — ฝั่งบริษัทชนะ
    expect(roundComplianceStatusServer(topicHardCutoffAhead, userId, morning, today, [], [], users, noExemptions, globalLockPassed, 0)).toBe("missed");
  });

  it("day on an exempt date (leave) → exempt, never missed", () => {
    const exemptions: DateExemptions = { personalDates: new Map([[userId, new Set([today])]]), companyDates: new Set() };
    expect(roundComplianceStatusServer(topicHardCutoffPassed, userId, morning, today, [], [], users, exemptions, noGlobalLock, 0)).toBe("exempt");
  });

  it("someone not in the round's submitters → exempt", () => {
    expect(roundComplianceStatusServer(topicHardCutoffPassed, otherUserId, morning, today, [], [], users, noExemptions, noGlobalLock, 0)).toBe("exempt");
  });
});

describe("computeReportPenaltyCandidates", () => {
  // lookbackDays: 0 — the room existed since Jan 1 and runs every day, so a
  // wider lookback would also (correctly) surface earlier missed days; these
  // three tests only care about today's single round, so they pin the walk
  // to just today to isolate that. notBeforeDay is set far in the past
  // (well before the room existed) so it never becomes the binding floor here.
  const noFloor = "2026-01-01";

  it("produces one missed candidate for a user who never posted and whose hard cutoff already passed, with the spec's refId shape", () => {
    const topic = topicWith([morning], "10:00"); // ปิดรับจริงไปแล้วตั้งแต่ 10 โมง (fake "now" = noon)
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, noGlobalLock, 0, 0, noFloor);
    const mine = candidates.filter((c) => c.userId === userId);
    expect(mine).toEqual([
      { userId, topicId: "t1", roundId: "r9", day: today, refId: `${today}:t1:r9:${userId}`, status: "missed" },
    ]);
  });

  it("past round time but no hard cutoff yet (or none configured) produces a late candidate, not missed", () => {
    const topic = topicWith([morning]); // ไม่ตั้ง hard cutoff เลย — ยังเปิดรับได้ทั้งวัน
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, noGlobalLock, 0, 0, noFloor);
    const mine = candidates.filter((c) => c.userId === userId);
    expect(mine.map((c) => c.status)).toEqual(["late"]);
  });

  it("an on-time post produces no candidate at all", () => {
    const topic = topicWith([morning], "10:00");
    const posts = [postAt(new Date(2026, 1, 2, 8, 30), "r9", userId)];
    const candidates = computeReportPenaltyCandidates([topic], posts, users, [], noExemptions, noGlobalLock, 0, 0, noFloor);
    expect(candidates.filter((c) => c.userId === userId)).toEqual([]);
  });

  it("a late post produces a late candidate, not missed", () => {
    const topic = topicWith([morning], "18:00"); // ยังไม่ปิดรับตอนโพสต์ (10:00)
    const posts = [postAt(new Date(2026, 1, 2, 10, 0), "r9", userId)];
    const candidates = computeReportPenaltyCandidates([topic], posts, users, [], noExemptions, noGlobalLock, 0, 0, noFloor);
    expect(candidates.filter((c) => c.userId === userId).map((c) => c.status)).toEqual(["late"]);
  });

  it("a room with no rounds at all (untracked) never produces a candidate", () => {
    const untracked: ReportTopic = { id: "t2", name: "untracked", color: "#000", createdAt: new Date(2026, 0, 1).toISOString(), minImages: 0, cutoffs: [] };
    const candidates = computeReportPenaltyCandidates([untracked], [], users, [], noExemptions, noGlobalLock, 0, 5, noFloor);
    expect(candidates).toEqual([]);
  });

  // Regression test for the real production bug: turning the feature on for
  // the first time must never backfill days from before that moment, no
  // matter how wide lookbackDays is — notBeforeDay is the real floor.
  it("notBeforeDay blocks backfill even with a wide lookback — the day the feature was turned on wins over lookbackDays", () => {
    const topic = topicWith([morning], "10:00"); // room existed since Jan 1, runs every day, never posted
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, noGlobalLock, 0, 45, today);
    const mine = candidates.filter((c) => c.userId === userId);
    expect(mine).toEqual([
      { userId, topicId: "t1", roundId: "r9", day: today, refId: `${today}:t1:r9:${userId}`, status: "missed" },
    ]);
  });
});

describe("computeReportPenaltyCandidates — weekly/monthly retroactive-submission grace window", () => {
  // fake "now" is 2026-02-02 (Monday), noon
  const dueDayWithinGrace = "2026-01-30"; // Friday — 3 calendar days before "today"
  const dueDayGraceExpired = "2026-01-23"; // Friday, one week earlier — grace (3 days) closed long ago
  const weekly: SubmissionRound = {
    id: "rw",
    label: "รอบสัปดาห์",
    time: "17:00",
    weekdays: [5], // Friday
    submitters: { mode: "people", userIds: [userId] },
  };

  it("overdue weekly round, still within the grace window, no post yet → no candidate at all (not missed yet)", () => {
    const topic = topicWith([weekly]);
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, noGlobalLock, 3, 10, "2026-01-01");
    expect(candidates.filter((c) => c.userId === userId && c.day === dueDayWithinGrace)).toEqual([]);
  });

  it("overdue weekly round, submitted (explicit roundId) within the grace window → late, not missed", () => {
    const topic = topicWith([weekly]);
    const posts = [postAt(new Date(2026, 1, 1, 9, 0), "rw", userId)]; // posted Sunday, 2 days after the Friday due date
    const candidates = computeReportPenaltyCandidates([topic], posts, users, [], noExemptions, noGlobalLock, 3, 10, "2026-01-01");
    const mine = candidates.filter((c) => c.userId === userId && c.day === dueDayWithinGrace);
    expect(mine.map((c) => c.status)).toEqual(["late"]);
  });

  it("a room with two rounds and an unmarked post (no roundId) can't be credited — stays unresolved, not wrongly late", () => {
    const other: SubmissionRound = { ...weekly, id: "rw2", weekdays: [6] }; // a second, unrelated round
    const topic = topicWith([weekly, other]);
    const ambiguousPost = { ...postAt(new Date(2026, 1, 1, 9, 0), undefined, userId) };
    const candidates = computeReportPenaltyCandidates([topic], [ambiguousPost], users, [], noExemptions, noGlobalLock, 3, 10, "2026-01-01");
    expect(candidates.filter((c) => c.userId === userId && c.day === dueDayWithinGrace)).toEqual([]);
  });

  it("grace window has expired with nothing submitted → missed", () => {
    const topic = topicWith([weekly]);
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, noGlobalLock, 3, 10, "2026-01-01");
    const mine = candidates.filter((c) => c.userId === userId && c.day === dueDayGraceExpired);
    expect(mine.map((c) => c.status)).toEqual(["missed"]);
  });

  it("grace days set to 0 → falls back to immediate missed the moment the due day passes, same as before this feature", () => {
    const topic = topicWith([weekly]);
    const candidates = computeReportPenaltyCandidates([topic], [], users, [], noExemptions, noGlobalLock, 0, 10, "2026-01-01");
    const mine = candidates.filter((c) => c.userId === userId && c.day === dueDayWithinGrace);
    expect(mine.map((c) => c.status)).toEqual(["missed"]);
  });
});
