import { describe, expect, it, vi } from "vitest";

vi.mock("@smartboss/database", () => ({ prisma: {} }));

import { lateDurationText, penaltyEvidence, roundPostsOf } from "@/modules/report_task/lib/penalty-evidence";
import { retroRemindersDue, type PenaltyRequest } from "@/modules/report_task/lib/db/report-penalty-requests";
import { DEFAULT_SCORE_PERIOD } from "@/lib/score-period";
import type { ReportPost, ReportTopic, SubmissionRound } from "@/modules/report_task/store/report-feed-store";

const morning: SubmissionRound = { id: "r9", label: "เช้า", time: "09:00", submitters: { mode: "people", userIds: ["u"] } };
const topic: ReportTopic = {
  id: "t1",
  name: "daily-report",
  color: "#000",
  createdAt: "2026-01-01T00:00:00.000Z",
  minImages: 0,
  cutoffs: [],
  submissionRounds: [morning],
};
const post = (id: string, createdAt: string, extra: Partial<ReportPost> = {}): ReportPost =>
  ({ id, topicId: "t1", authorId: "u", createdAt, editedAt: null, pinned: false, savedBy: [], unreadFor: [], reactions: {}, stickerReactions: [], replies: [], title: "x", sections: [], images: [], tagIds: [], ...extra }) as ReportPost;
const input = { userId: "u", topicId: "t1", roundId: "r9", day: "2026-11-03" };

describe("หลักฐานของคำร้อง", () => {
  it("ส่งสาย: บอกเวลาโพสต์จริงและช้าเท่าไหร่ตามเวลาไทย", () => {
    const e = penaltyEvidence([topic], [post("p1", "2026-11-03T10:22:00+07:00")], input);
    expect(e?.roomName).toBe("daily-report");
    expect(e?.dueText).toContain("09:00");
    expect(e?.post?.text).toContain("10:22");
    expect(e?.post?.lateText).toBe("1 ชม. 22 นาที");
    expect(e?.post?.href).toBe("/chat-report/report-feed?topic=t1&post=p1");
  });
  it("โพสต์ห้องอื่น หรือโพสต์ที่ไม่นับ ไม่ถือเป็นโพสต์ของรอบนี้", () => {
    const posts = [post("other", "2026-11-03T10:22:00+07:00", { topicId: "t2" }), post("skip", "2026-11-03T10:30:00+07:00", { excludeFromSubmission: true })];
    expect(penaltyEvidence([topic], posts, input)?.post).toBeNull();
  });
  it("รอบรายวันไม่เอาโพสต์ของวันถัดไปมานับ", () => {
    expect(roundPostsOf(topic, [post("next", "2026-11-04T08:00:00+07:00")], "u", "2026-11-03", "r9")).toEqual([]);
  });
  it("รอบรายสัปดาห์ยังใช้โพสต์แรกในช่วงเผื่อเวลา", () => {
    const weekly = { ...topic, submissionRounds: [{ ...morning, frequency: "weekly", weekdays: [2] } as SubmissionRound] };
    expect(roundPostsOf(weekly, [post("next", "2026-11-04T08:00:00+07:00")], "u", "2026-11-03", "r9").map((p) => p.id)).toEqual(["next"]);
  });
  it("ข้อความระยะเวลา", () => {
    expect(lateDurationText(5 * 60_000)).toBe("5 นาที");
    expect(lateDurationText(60 * 60_000)).toBe("1 ชม.");
    expect(lateDurationText(26 * 60 * 60_000)).toBe("1 วัน 2 ชม.");
  });
});

describe("เตือนส่งย้อนหลังก่อนหมดเวลา (วันสุดท้าย 25 พ.ย.)", () => {
  const req = (extra: Partial<PenaltyRequest> = {}): PenaltyRequest => ({
    id: "q",
    userId: "u",
    submittedBy: "u",
    refId: "2026-11-03:t1:r9:u",
    category: "report_missed",
    points: -2,
    topicId: "t1",
    roundId: "r9",
    day: "2026-11-03",
    type: "retroactive",
    reason: "x",
    status: "approved",
    createdAt: "2026-11-04T08:00:00.000Z",
    decidedAt: "2026-11-04T09:00:00.000Z",
    awaitingPost: true,
    ...extra,
  });
  const at = (s: string) => new Date(`${s}+07:00`);
  const due = (r: PenaltyRequest, s: string) => retroRemindersDue([r], DEFAULT_SCORE_PERIOD, at(s)).map((x) => [x.kind, x.daysLeft]);

  it("ยังไม่ถึงเวลา = ไม่เตือน", () => {
    expect(due(req(), "2026-11-22T08:59:00")).toEqual([]);
  });
  it("09:00 ของ 3 วันก่อนวันสุดท้าย", () => {
    expect(due(req(), "2026-11-22T09:00:00")).toEqual([["soon", 3]]);
  });
  it("ไม่มีใครเปิดเว็บวันนั้น เตือนย้อนหลังด้วยจำนวนวันที่เหลือจริง", () => {
    expect(due(req(), "2026-11-24T15:00:00")).toEqual([["soon", 1]]);
  });
  it("09:00 ของวันสุดท้าย และเตือนได้แม้เคยเตือนรอบแรกแล้ว", () => {
    expect(due(req({ retroRemindedSoonAt: "x" }), "2026-11-25T09:00:00")).toEqual([["last", 0]]);
  });
  it("เตือนแล้วไม่เตือนซ้ำ", () => {
    expect(due(req({ retroRemindedSoonAt: "x" }), "2026-11-23T09:00:00")).toEqual([]);
    expect(due(req({ retroRemindedLastAt: "x" }), "2026-11-25T20:00:00")).toEqual([]);
  });
  it("ส่งแล้ว ไม่อนุมัติ หรือหมดเวลา = ไม่เตือน", () => {
    expect(due(req({ fulfilledAt: "x" }), "2026-11-25T09:00:00")).toEqual([]);
    expect(due(req({ status: "rejected" }), "2026-11-25T09:00:00")).toEqual([]);
    expect(due(req(), "2026-11-26T00:00:00")).toEqual([]);
  });
  it("เพิ่งอนุมัติหลังเวลาเตือน ไม่เด้งซ้ำทันที", () => {
    expect(due(req({ decidedAt: at("2026-11-23T10:00:00").toISOString() }), "2026-11-23T10:01:00")).toEqual([]);
    expect(due(req({ decidedAt: at("2026-11-25T10:00:00").toISOString() }), "2026-11-25T10:01:00")).toEqual([]);
  });
});
