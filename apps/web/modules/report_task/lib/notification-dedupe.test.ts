import { describe, expect, it } from "vitest";

import { dropDuplicateNotifications, isDuplicateNotification } from "./notification-dedupe";

const at = (iso: string) => `2026-10-19T02:50:${iso}Z`;
const review = (id: string, userId: string, sec: string) => ({
  id,
  userId,
  byUserId: "admin",
  message: 'ผู้ดูแลระบบสูงสุด ส่งงาน "HS3-ปั้มสระว่ายน้ำเสีย" แล้ว รอคุณตรวจ',
  createdAt: at(sec),
});

describe("กันแจ้งเตือนเบิ้ล", () => {
  it("เคสจริง 19/10: ส่งงาน/รอตรวจ ซ้ำห่างกัน 5.5 วินาที = ซ้ำ (ตัดทิ้ง)", () => {
    const first = [review("a", "ceo", "11.012"), review("b", "os", "11.012")];
    const second = [review("c", "os", "16.546"), review("d", "ceo", "16.546")];
    expect(dropDuplicateNotifications(second, first)).toEqual([]);
  });

  it("คนละผู้รับ ไม่ถือว่าซ้ำ", () => {
    expect(isDuplicateNotification([review("a", "ceo", "11.000")], review("b", "os", "12.000"))).toBe(false);
  });

  it("ความคิดเห็นเหมือนกันห่างกันเกิน 5 วินาที = สองข้อความจริง ไม่ตัด", () => {
    const c = (id: string, sec: string) => ({ id, userId: "u", byUserId: "x", message: 'x แสดงความคิดเห็นในงาน "A": ok', kind: "task_comment", createdAt: at(sec) });
    expect(isDuplicateNotification([c("a", "01.000")], c("b", "08.000"))).toBe(false);
    expect(isDuplicateNotification([c("a", "01.000")], c("b", "03.000"))).toBe(true);
  });

  it("เหตุการณ์เดียวกันห่างเกิน 10 นาที = ใหม่จริง", () => {
    const a = review("a", "ceo", "11.000");
    const b = { ...review("b", "ceo", "11.000"), createdAt: "2026-10-19T03:01:00Z" };
    expect(isDuplicateNotification([a], b)).toBe(false);
  });

  it("ชุดเดียวกันซ้ำกันเอง เก็บตัวแรก", () => {
    const kept = dropDuplicateNotifications([review("a", "ceo", "11.000"), review("b", "ceo", "11.001")], []);
    expect(kept.map((k) => k.id)).toEqual(["a"]);
  });
});
