import { describe, it, expect } from "vitest";
import { aboutMeCountInPost } from "./report-feed-activity";
import type { ReportPost } from "@/modules/report_task/store/report-feed-store";

const tag = (id: string) => `@[x](user:${id})`;
const reply = (id: string, authorId: string, body: string, unreadFor: string[] = ["ME"]) => ({
  id, authorId, body, createdAt: "2026-11-26T00:00:00Z", unreadFor,
});
const post = (authorId: string, body: string, replies: ReturnType<typeof reply>[]): ReportPost =>
  ({ id: "p", topicId: "t", authorId, title: "t", sections: [{ bullets: [body] }], unreadFor: [], replies } as unknown as ReportPost);

describe("aboutMeCountInPost — follow a post like Facebook", () => {
  it("counts comments on my own post (unchanged)", () => {
    expect(aboutMeCountInPost(post("ME", "hi", [reply("r1", "A", "ok"), reply("r2", "B", "x")]), "ME")).toBe(2);
  });
  it("tagged in the post → later untagged comments count", () => {
    expect(aboutMeCountInPost(post("A", `ดูหน่อย ${tag("ME")}`, [reply("r1", "B", "คุยต่อ"), reply("r2", "A", "อีก")]), "ME")).toBe(2);
  });
  it("commented earlier → later comments count, earlier ones don't", () => {
    const p = post("A", "hi", [reply("r0", "B", "ก่อนเรา"), reply("r1", "ME", "เรา", []), reply("r2", "B", "หลังเรา")]);
    expect(aboutMeCountInPost(p, "ME")).toBe(1);
  });
  it("tagged in a comment → later comments count too", () => {
    const p = post("A", "hi", [reply("r1", "B", `${tag("ME")} ช่วยดู`), reply("r2", "A", "ต่อ")]);
    expect(aboutMeCountInPost(p, "ME")).toBe(2);
  });
  it("a post I have nothing to do with → 0", () => {
    expect(aboutMeCountInPost(post("A", "hi", [reply("r1", "B", "x")]), "ME")).toBe(0);
  });
  it("read comments don't count", () => {
    expect(aboutMeCountInPost(post("A", `${tag("ME")}`, [reply("r1", "B", "x", [])]), "ME")).toBe(0);
  });
});
