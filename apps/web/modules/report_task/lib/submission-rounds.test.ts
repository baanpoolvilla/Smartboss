import { describe, expect, it } from "vitest";
import {
  attributePostToRound,
  attributionRounds,
  postsOfRound,
  earlyDueDayOf,
  earlyPostsForRound,
  normalizeEarlySubmitDays,
} from "@/modules/report_task/lib/submission-rounds";
import type { SubmissionRound } from "@/modules/report_task/store/report-feed-store";

const round = (id: string, time: string): SubmissionRound =>
  ({ id, label: id, time, submitters: { mode: "all" } }) as unknown as SubmissionRound;
const rounds = [round("morning", "09:00"), round("evening", "17:00")];
const post = (id: string, time: string, roundId?: string) => ({ id, createdAt: `2026-10-13T${time}:00`, ...(roundId ? { roundId } : {}) });

describe("attributePostToRound with the day's posts", () => {
  it("a late morning post catches up the missed morning round; the afternoon post goes to evening (13/10/2569)", () => {
    const day = [post("a", "09:28"), post("b", "16:36")];
    expect(attributePostToRound(day[0]!, rounds, day)?.id).toBe("morning");
    expect(attributePostToRound(day[1]!, rounds, day)?.id).toBe("evening");
    expect(postsOfRound(day, rounds, "morning").map((p) => p.id)).toEqual(["a"]);
  });

  it("only an afternoon post that day still catches up the overdue morning round", () => {
    const day = [post("b", "16:56")];
    expect(attributePostToRound(day[0]!, rounds, day)?.id).toBe("morning");
  });

  it("two posts before 09:00 both count for morning, not one for evening", () => {
    const day = [post("a", "08:00"), post("b", "08:30")];
    expect(attributePostToRound(day[1]!, rounds, day)?.id).toBe("morning");
  });

  it("a round picked explicitly isn't caught up by another post", () => {
    const day = [post("a", "08:50", "morning"), post("b", "16:00")];
    expect(attributePostToRound(day[1]!, rounds, day)?.id).toBe("evening");
  });

  it("without the day's posts it keeps the old time-only guess", () => {
    expect(attributePostToRound(post("a", "09:28"), rounds)?.id).toBe("evening");
  });

  it("another department's overdue round never takes the post (shared room, 13/10/2569)", () => {
    const otherDeptMorning = round("other-morning", "09:00");
    const myEvening = round("my-evening", "18:00");
    const day = [post("a", "17:14")];
    // ทุกรอบของห้อง: รอบเช้าของแผนกอื่น "ค้าง" อยู่ เลยแย่งโพสต์ไป — ผิด
    expect(attributePostToRound(day[0]!, [otherDeptMorning, myEvening], day)?.id).toBe("other-morning");
    // เฉพาะรอบของคนนี้: เข้ารอบเย็นของตัวเอง
    const pool = attributionRounds([myEvening], [otherDeptMorning, myEvening]);
    expect(attributePostToRound(day[0]!, pool, day)?.id).toBe("my-evening");
  });
});

describe("ส่งล่วงหน้า (early submit) for weekly/monthly rounds", () => {
  const cfg = { weekly: 1, monthly: 5 };
  const weekly = { ...round("w", "17:00"), weekdays: [5] } as SubmissionRound; // ทุกวันศุกร์ (30/10/2026)
  const monthly = { ...round("m", "17:00"), dayOfMonth: 30 } as SubmissionRound;
  const daily = round("d", "17:00");
  const p = (day: string, roundId?: string, extra: object = {}) => ({
    topicId: "t",
    authorId: "u",
    createdAt: `${day}T20:00:00`,
    ...(roundId ? { roundId } : {}),
    ...extra,
  });

  it("weekly: only the day before the due date is inside the window", () => {
    expect(earlyDueDayOf(weekly, "2026-10-29", cfg)).toBe("2026-10-30");
    expect(earlyDueDayOf(weekly, "2026-10-28", cfg)).toBeNull();
    expect(earlyDueDayOf(weekly, "2026-10-30", cfg)).toBeNull(); // วันครบกำหนดเอง = ส่งปกติ
  });

  it("monthly: up to 5 days before; daily never", () => {
    expect(earlyDueDayOf(monthly, "2026-10-25", cfg)).toBe("2026-10-30");
    expect(earlyDueDayOf(monthly, "2026-10-24", cfg)).toBeNull();
    expect(earlyDueDayOf(daily, "2026-10-29", cfg)).toBeNull();
  });

  it("an early post counts only when it picked that round, inside the window", () => {
    const posts = [p("2026-10-29", "w"), p("2026-10-29"), p("2026-10-28", "w"), p("2026-10-29", "w", { excludeFromSubmission: true })];
    expect(earlyPostsForRound(posts, "t", "u", weekly, "2026-10-30", cfg)).toEqual([posts[0]]);
    expect(earlyPostsForRound(posts, "t", "u", weekly, "2026-10-30", { weekly: 0, monthly: 0 })).toEqual([]);
  });

  it("settings are clamped and fall back to defaults", () => {
    expect(normalizeEarlySubmitDays(null)).toEqual({ weekly: 1, monthly: 5 });
    expect(normalizeEarlySubmitDays({ weekly: 10, monthly: -1 })).toEqual({ weekly: 6, monthly: 5 });
  });
});
