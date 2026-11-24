import { describe, expect, it } from "vitest";
import { findReportFormatViolations } from "./report-format-guard";

const TOPICS = ["ส่งงานอะไร", "ปัญหา"];
const topic = (requiredTopics?: string[], requireStatusColor?: boolean) => ({
  id: "room",
  submissionRounds: [
    { id: "eve", requiredTopics, requireStatusColor },
    { id: "free" },
  ],
});
const good = { title: "Daily", sections: [{ heading: "", bullets: ["🟢 ส่งงานอะไร", "ทำ A", "🟡 ปัญหา", "ไม่มี"] }] };
const bad = { title: "Daily", sections: [{ heading: "", bullets: ["🟢 ส่งงานอะไร", "ทำ A"] }] };
const post = (id: string, content: object, extra: object = {}) => ({ id, topicId: "room", roundId: "eve", ...content, ...extra });

describe("findReportFormatViolations — ตรวจรูปแบบรีพอตที่เซิร์ฟเวอร์", () => {
  const before = { topics: [topic(TOPICS)], posts: [] };

  it("โพสต์ใหม่ครบ = ผ่าน · ขาดหัวข้อ = ไม่ผ่าน", () => {
    expect(findReportFormatViolations(before, { topics: [topic(TOPICS)], posts: [post("p1", good)] })).toEqual([]);
    const v = findReportFormatViolations(before, { topics: [topic(TOPICS)], posts: [post("p1", bad)] });
    expect(v).toHaveLength(1);
    expect(v[0]!.postId).toBe("p1");
  });

  it("รอบที่ไม่ได้ตั้งหัวข้อ / ห้องไม่มีรอบ = ไม่ตรวจ", () => {
    expect(findReportFormatViolations(before, { topics: [topic(TOPICS)], posts: [post("p1", bad, { roundId: "free" })] })).toEqual([]);
    expect(findReportFormatViolations(before, { topics: [topic(undefined)], posts: [post("p1", bad)] })).toEqual([]);
  });

  it("โพสต์ใหม่ที่ติ๊ก 'ไม่ใช่รีพอต' ไม่ตรวจ · ส่งย้อนหลังตรวจตามรอบที่ลืม", () => {
    expect(
      findReportFormatViolations(before, { topics: [topic(TOPICS)], posts: [post("p1", bad, { excludeFromSubmission: true })] })
    ).toEqual([]);
    expect(
      findReportFormatViolations(before, {
        topics: [topic(TOPICS)],
        posts: [post("p1", bad, { roundId: undefined, excludeFromSubmission: true, retroFor: { requestId: "r", day: "2026-11-20", roundId: "eve" } })],
      })
    ).toHaveLength(1);
  });

  it("โพสต์เดิมที่ไม่ได้แก้เนื้อหา ไม่ถูกตรวจย้อนหลัง (เช่น ติดสติกเกอร์)", () => {
    const old = post("p1", bad);
    expect(findReportFormatViolations({ ...before, posts: [old] }, { topics: [topic(TOPICS)], posts: [{ ...old, reactions: [{ x: 1 }] }] })).toEqual([]);
  });

  it("แก้โพสต์แล้วลบหัวข้อออก = ไม่ผ่าน · โพสต์เก่าที่ติ๊ก 'ไม่ใช่รีพอต' แก้ได้", () => {
    const old = post("p1", good);
    expect(findReportFormatViolations({ ...before, posts: [old] }, { topics: [topic(TOPICS)], posts: [post("p1", bad)] })).toHaveLength(1);
    const oldExcluded = post("p2", good, { excludeFromSubmission: true });
    expect(
      findReportFormatViolations({ ...before, posts: [oldExcluded] }, { topics: [topic(TOPICS)], posts: [post("p2", bad, { excludeFromSubmission: true })] })
    ).toEqual([]);
  });

  it("ไม่บังคับสี = หัวข้อไม่มีสีก็ผ่าน", () => {
    const noColor = { title: "Daily", sections: [{ heading: "", bullets: ["ส่งงานอะไร", "ทำ A", "ปัญหา", "ไม่มี"] }] };
    expect(findReportFormatViolations(before, { topics: [topic(TOPICS, false)], posts: [post("p1", noColor)] })).toEqual([]);
    expect(findReportFormatViolations(before, { topics: [topic(TOPICS)], posts: [post("p1", noColor)] })).toHaveLength(1);
  });
});
