import { describe, expect, it } from "vitest";
import { attributePostToRound, attributionRounds, postsOfRound } from "@/modules/report_task/lib/submission-rounds";
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
