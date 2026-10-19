import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUserComplianceReports, dayComplianceStatus, roundComplianceStatus } from "@/modules/report_task/lib/report-feed-compliance";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";
import { users } from "@/modules/report_task/lib/directory";
import type { ReportPost, ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import type { User } from "@/modules/report_task/types";

// คนในบริษัทโหลดจากเซิร์ฟเวอร์ (store เริ่มว่าง — แอปไม่มีคนตัวอย่างแล้ว) ⇒ ใส่คนในไดเรกทอรีของเทสต์นี้เอง
useEmployeeStore.setState({
  employees: [{ id: "usr-directory-01", name: "usr-directory-01", email: "dir@test", avatar: "", role: "", departmentId: "dep-a" } as User],
});

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
    stickerReactions: [],
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

describe("buildUserComplianceReports — countPending (ห้องสรุปรีพอร์ต: ส่งเช้าแล้วรอเย็น = 50%)", () => {
  const dirUser = "usr-directory-01";
  const am: SubmissionRound = { id: "am", label: "เช้า", time: "09:00", submitters: { mode: "people", userIds: [dirUser] } };
  const pm: SubmissionRound = { id: "pm", label: "เย็น", time: "18:00", submitters: { mode: "people", userIds: [dirUser] } };
  const topic = { ...topicWith([am, pm]), createdAt: new Date(2026, 1, 2).toISOString() };
  const posts = [postAt(new Date(2026, 1, 2, 8, 30), "am", dirUser)];
  const range = { from: new Date(2026, 1, 2), to: new Date(2026, 1, 2, 23, 59) };
  const row = (opts?: { countPending?: boolean }) =>
    buildUserComplianceReports([topic], posts, range, undefined, opts).find((r) => r.id === dirUser)!;

  it("default (dashboard): the not-yet-due evening round is left out → 100%", () => {
    expect(row().complianceRate).toBe(100);
    expect(row().pending).toBe(0);
  });

  it("countPending: the evening round still counts toward the total → 50%", () => {
    const r = row({ countPending: true });
    expect(r.trackedDays).toBe(2);
    expect(r.pending).toBe(1);
    expect(r.complianceRate).toBe(50);
  });
});
