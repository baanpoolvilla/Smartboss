import { describe, expect, it } from "vitest";

import { buildReportTaskPrefill } from "./report-task-prefill";
import type { ReportPost, ReportPostReply } from "@/modules/report_task/store/report-feed-store";

const names: Record<string, string> = { me: "ฉัน", aui: "Aui", os: "Os", nok: "Nok" };
const base = {
  topic: { id: "t1", name: "Customer Care" },
  meId: "me",
  nameOf: (id: string) => names[id],
  isKnownUser: (id: string) => id in names,
};
const post = {
  id: "p1",
  authorId: "nok",
  title: "ลูกค้าแจ้งแอร์เสีย",
  createdAt: "2026-11-02T03:00:00.000Z",
  sections: [{ id: "s1", heading: "รายละเอียด", bullets: ["บ้าน A", "ห้องนอน @[Aui](user:aui)"] }],
  images: [],
  replies: [],
} as unknown as ReportPost;
const reply = (over: Partial<ReportPostReply>) =>
  ({ id: "r1", authorId: "os", body: "ตามงานด้วย", createdAt: "2026-11-02T04:00:00.000Z", ...over }) as ReportPostReply;

describe("buildReportTaskPrefill", () => {
  it("post: keeps title and full sections, not only the heading", () => {
    const p = buildReportTaskPrefill({ ...base, post });
    expect(p.title).toBe("ลูกค้าแจ้งแอร์เสีย");
    expect(p.description).toContain("รายละเอียด\nบ้าน A\nห้องนอน @Aui");
    expect(p.description).toContain('จากรีพอต "Customer Care"');
    expect(p.description).not.toContain("user:aui");
    expect(p.assigneeIds).toEqual(["aui"]);
    expect(p.source.kind).toBe("report_post");
    expect(p.source.link).toBe("/chat-report/report-feed?topic=t1&post=p1");
  });

  it("post with no tags falls back to the author", () => {
    const p = buildReportTaskPrefill({ ...base, post: { ...post, sections: [] } });
    expect(p.assigneeIds).toEqual(["nok"]);
  });

  it("reply: tagged person first, links to the reply, names the post", () => {
    const r = reply({ body: "@[Aui](user:aui) ถ้าไม่เปิดใบงาน\nบรรทัดสอง" });
    const p = buildReportTaskPrefill({ ...base, post, reply: r });
    expect(p.title).toBe("ถ้าไม่เปิดใบงาน");
    expect(p.description).toContain("@Aui ถ้าไม่เปิดใบงาน");
    expect(p.description).toContain("บรรทัดสอง");
    expect(p.description).toContain("โพสต์: ลูกค้าแจ้งแอร์เสีย");
    expect(p.assigneeIds).toEqual(["aui"]);
    expect(p.source.kind).toBe("report_reply");
    expect(p.source.link).toContain("&reply=r1");
  });

  it("never suggests yourself; tagging only yourself falls back to the author", () => {
    expect(buildReportTaskPrefill({ ...base, post, reply: reply({ body: "@[ฉัน](user:me) ฝากด้วย" }) }).assigneeIds).toEqual(["os"]);
    expect(buildReportTaskPrefill({ ...base, post, reply: reply({ authorId: "me" }) }).assigneeIds).toEqual([]);
  });

  it("Openchat post (whole message in title) keeps every line", () => {
    const p = buildReportTaskPrefill({ ...base, post: { ...post, title: "บรรทัดแรก\nบรรทัดสอง", sections: [] } });
    expect(p.title).toBe("บรรทัดแรก");
    expect(p.description).toContain("บรรทัดแรก\nบรรทัดสอง");
  });

  it("image-only reply still gets a usable title", () => {
    expect(buildReportTaskPrefill({ ...base, post, reply: reply({ body: "" }) }).title).toBe("งานจากรีพอต Customer Care");
  });
});
