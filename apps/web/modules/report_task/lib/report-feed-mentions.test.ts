import { beforeAll, describe, expect, it } from "vitest";
import { taggedUserIds, textMentionsUser } from "@/modules/report_task/lib/report-feed-mentions";
import { CEO_MENTION_ID, mentionMarker, mentionMarkersToPlainText } from "@/modules/report_task/lib/report-feed-rich-text";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import type { User } from "@/modules/report_task/types";

// แท็ก @CEO (ผู้ใช้ขอ 23/10/2569 "อยากให้แท็ก @ceo ด้วย เห็นเฉพาะ ceo") — แจ้งเฉพาะคนที่ถือ role CEO และเห็นห้องนั้น
beforeAll(() => {
  const person = (id: string, departmentId: string, extra: Partial<User> = {}): User =>
    ({ id, name: id, email: `${id}@test`, avatar: "", role: "", departmentId, ...extra }) as User;
  useEmployeeStore.setState({
    employees: [
      person("ceo-1", "dep-a", { isCeo: true, isOwner: true }),
      person("ceo-2", "dep-b", { isCeo: true }),
      person("staff-1", "dep-a"),
      person("staff-2", "dep-b"),
    ],
  });
});

const ceoTag = mentionMarker("role", CEO_MENTION_ID, "CEO");

describe("@CEO mention", () => {
  it("tags every CEO who can see the room, nobody else", () => {
    expect(taggedUserIds(`ดูหน่อยครับ ${ceoTag}`).sort()).toEqual(["ceo-1", "ceo-2"]);
  });
  it("a CEO who can't see the room isn't tagged (owner CEO always sees)", () => {
    const roomA = { visibility: { departmentIds: ["dep-a"] } };
    expect(taggedUserIds(ceoTag, roomA)).toEqual(["ceo-1"]);
  });
  it("counts as 'mentions me' only for CEOs", () => {
    expect(textMentionsUser(ceoTag, "ceo-2")).toBe(true);
    expect(textMentionsUser(ceoTag, "staff-1")).toBe(false);
  });
  it("reads back as @CEO in plain text, never the raw marker", () => {
    expect(mentionMarkersToPlainText(`ถึง ${ceoTag} ครับ`)).toBe("ถึง @CEO ครับ");
  });
  it("mixed with a person tag — both, no duplicates", () => {
    expect(taggedUserIds(`${ceoTag} ${mentionMarker("user", "ceo-1", "ceo-1")} ${mentionMarker("user", "staff-1", "staff-1")}`).sort()).toEqual(["ceo-1", "ceo-2", "staff-1"]);
  });
});
