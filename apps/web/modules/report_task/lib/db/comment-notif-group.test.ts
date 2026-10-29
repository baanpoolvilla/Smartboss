import { describe, expect, it } from "vitest";

import { topicForReportNotification } from "@/modules/notifications/prefs";
import { groupTaskCommentNotifications } from "./comment-notif-group";

const row = (id: string, message: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: "u-ceo",
  byUserId: "u-a",
  message,
  createdAt: "2026-10-29T03:00:00.000Z",
  read: false,
  kind: "task_comment",
  taskId: "t1",
  ...extra,
});

describe("groupTaskCommentNotifications", () => {
  it("folds a new comment into the unread row of the same task (any author), no new pop", () => {
    const stored = [row("a", 'Aui แสดงความคิดเห็นในงาน "MG-BT ราคา": ราคากรอบบนค่ะ')];
    const incoming = [row("b", 'Bee แสดงความคิดเห็นในงาน "MG-BT ราคา": สรุปตัวเลขแล้วนะคะ', { byUserId: "u-b", createdAt: "2026-10-29T04:00:00.000Z" })];
    const r = groupTaskCommentNotifications(incoming, stored);
    expect(r.stored).toHaveLength(0);
    expect(r.incoming).toHaveLength(1);
    expect(r.incoming[0]).toMatchObject({
      id: "b",
      grouped: true,
      absorbedIds: ["a"],
      commentCount: 2,
      message: '2 ความคิดเห็นใหม่ · Bee และ Aui แสดงความคิดเห็นในงาน "MG-BT ราคา" — ล่าสุด: สรุปตัวเลขแล้วนะคะ',
    });
    // ยังจัดเป็น "ความคิดเห็นในงาน" — ค่าตั้งแจ้งเตือนเดิมใช้ได้
    expect(topicForReportNotification({ message: r.incoming[0]!.message, kind: "task_comment" })).toBe("pm.comment");
  });

  it("keeps counting across rounds and lists extra authors as 'และอีก N คน'", () => {
    let stored = [row("a", 'A แสดงความคิดเห็นในงาน "T": หนึ่ง')];
    for (const [id, who] of [["b", "B"], ["c", "C"], ["d", "A"]] as const) {
      const r = groupTaskCommentNotifications([row(id, `${who} แสดงความคิดเห็นในงาน "T": ข้อความ ${id}`)], stored);
      stored = [...r.incoming, ...r.stored];
    }
    expect(stored).toHaveLength(1);
    expect(stored[0]!.message).toBe('4 ความคิดเห็นใหม่ · A, C และอีก 1 คน แสดงความคิดเห็นในงาน "T" — ล่าสุด: ข้อความ d');
  });

  it("does not fold into a read row, another task, or another recipient", () => {
    const stored = [
      row("read", 'A แสดงความคิดเห็นในงาน "T": x', { read: true }),
      row("other-task", 'A แสดงความคิดเห็นในงาน "U": x', { taskId: "t2" }),
      row("other-user", 'A แสดงความคิดเห็นในงาน "T": x', { userId: "u-staff" }),
    ];
    const r = groupTaskCommentNotifications([row("new", 'B แสดงความคิดเห็นในงาน "T": y')], stored);
    expect(r.incoming[0]).toMatchObject({ id: "new" });
    expect(r.incoming[0]).not.toHaveProperty("grouped");
    expect(r.stored).toHaveLength(3);
  });

  it("a tag stays its own row; 'รับทราบ' folds into the task's comment row (shown to people on the task, 1c53205)", () => {
    const stored = [row("a", 'A แสดงความคิดเห็นในงาน "T": ราคากรอบบน')];
    const tag = row("tag", 'B แท็กคุณในงาน "T": @CEO ดูหน่อยครับ');
    const ack = row("ack", 'B แสดงความคิดเห็นในงาน "T": รับทราบค่ะ');
    const r = groupTaskCommentNotifications([tag, ack], stored);
    expect(r.incoming.map((n) => n.id)).toEqual(["tag", "ack"]);
    expect(r.incoming[1]).toMatchObject({ grouped: true, commentCount: 2, absorbedIds: ["a"] });
    expect(r.stored).toHaveLength(0);
  });
});
