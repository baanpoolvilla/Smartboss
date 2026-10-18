import { describe, expect, it } from "vitest";

import { absorbedIdSet, groupAttachmentNotifications, GROUP_WINDOW_MS } from "./attachment-notif-group";

const NOW = Date.parse("2026-10-15T10:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const row = (id: string, message: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: "u-boss",
  byUserId: "u-a",
  message,
  createdAt: at(0),
  read: false,
  kind: "task_attachment",
  taskId: "t1",
  ...extra,
});
const one = (file: string) => `A-Sujita แนบไฟล์ "${file}" ในงาน "บ้านอ้อหลักคารั่ว"`;

describe("groupAttachmentNotifications", () => {
  it("merges a second single-file upload into the unread row", () => {
    const stored = [row("n1", one("IMG_1.jpeg"), { createdAt: at(60_000) })];
    const r = groupAttachmentNotifications([row("n2", one("IMG_2.jpeg"))], stored, NOW);
    expect(r.stored).toEqual([]);
    expect(r.incoming).toHaveLength(1);
    expect(r.incoming[0]).toMatchObject({
      id: "n2",
      message: 'A-Sujita แนบไฟล์ 2 ไฟล์ ในงาน "บ้านอ้อหลักคารั่ว"',
      grouped: true,
      absorbedIds: ["n1"],
    });
  });

  it("keeps counting on top of an already grouped row", () => {
    const stored = [row("n2", 'A-Sujita แนบไฟล์ 5 ไฟล์ ในงาน "บ้านอ้อหลักคารั่ว"', { grouped: true, absorbedIds: ["n1"] })];
    const r = groupAttachmentNotifications([row("n3", one("IMG_6.jpeg"))], stored, NOW);
    expect(r.incoming[0]).toMatchObject({ message: 'A-Sujita แนบไฟล์ 6 ไฟล์ ในงาน "บ้านอ้อหลักคารั่ว"', absorbedIds: ["n1", "n2"] });
    expect(absorbedIdSet(r.incoming)).toEqual(new Set(["n1", "n2"]));
  });

  it("starts a new row once the old one was read, is too old, or is another task/person", () => {
    const fresh = [row("n9", one("IMG_9.jpeg"))];
    for (const prev of [
      row("p", one("a"), { read: true }),
      row("p", one("a"), { createdAt: at(GROUP_WINDOW_MS + 1) }),
      row("p", one("a"), { taskId: "t2" }),
      row("p", one("a"), { byUserId: "u-other" }),
    ]) {
      const r = groupAttachmentNotifications(fresh, [prev], NOW);
      expect(r.incoming).toEqual(fresh);
      expect(r.stored).toEqual([prev]);
    }
  });

  it("leaves other kinds alone", () => {
    const stored = [row("c1", "A ความเห็น", { kind: "task_comment" })];
    const incoming = [row("c2", "A ความเห็น", { kind: "task_comment" })];
    expect(groupAttachmentNotifications(incoming, stored, NOW)).toEqual({ incoming, stored });
  });

  describe("photo-only comments (sent one by one, LINE-style)", () => {
    const pic = (n?: number) => `A-Sujita แสดงความคิดเห็นในงาน "บ้านอ้อหลักคารั่ว": ${n ? `ส่งรูป ${n} รูป` : "ส่งรูป"}`;
    const crow = (id: string, message: string, extra: Record<string, unknown> = {}) => row(id, message, { kind: "task_comment", ...extra });

    it("3 photos sent as 3 comments become one notification", () => {
      let stored = [crow("c1", pic(), { createdAt: at(90_000) })];
      let r = groupAttachmentNotifications([crow("c2", pic(), { createdAt: at(60_000) })], stored, NOW);
      stored = [...r.incoming, ...r.stored];
      r = groupAttachmentNotifications([crow("c3", pic())], stored, NOW);
      expect(r.stored).toEqual([]);
      expect(r.incoming).toHaveLength(1);
      expect(r.incoming[0]).toMatchObject({ id: "c3", message: pic(3), grouped: true, absorbedIds: ["c1", "c2"] });
    });

    it("photos then a file reads as files", () => {
      const stored = [crow("c1", pic(2), { createdAt: at(60_000) })];
      const r = groupAttachmentNotifications([crow("c2", 'A-Sujita แสดงความคิดเห็นในงาน "บ้านอ้อหลักคารั่ว": แนบไฟล์')], stored, NOW);
      expect(r.incoming[0]!.message).toBe('A-Sujita แสดงความคิดเห็นในงาน "บ้านอ้อหลักคารั่ว": แนบไฟล์ 3 ไฟล์');
    });

    it("a comment with text is never merged", () => {
      const stored = [crow("c1", pic(), { createdAt: at(60_000) })];
      const r = groupAttachmentNotifications([crow("c2", 'A-Sujita แสดงความคิดเห็นในงาน "บ้านอ้อหลักคารั่ว": ส่งรูปแล้วนะคะ')], stored, NOW);
      expect(r.incoming).toHaveLength(1);
      expect(r.stored).toHaveLength(1);
    });

    it("an already-read photo notification is not reopened", () => {
      const stored = [crow("c1", pic(), { createdAt: at(60_000), read: true })];
      const r = groupAttachmentNotifications([crow("c2", pic())], stored, NOW);
      expect(r.incoming[0]!.message).toBe(pic());
      expect(r.stored).toHaveLength(1);
    });

    it("photo comments and task attachments stay separate rows", () => {
      const stored = [row("a1", one("IMG_1.jpeg"), { createdAt: at(60_000) })];
      const r = groupAttachmentNotifications([crow("c1", pic())], stored, NOW);
      expect(r.incoming[0]!.message).toBe(pic());
      expect(r.stored).toHaveLength(1);
    });
  });
});
