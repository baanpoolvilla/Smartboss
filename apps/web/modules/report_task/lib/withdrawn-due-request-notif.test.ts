import { describe, expect, it } from "vitest";

import { isWithdrawnDueRequestNotification } from "./withdrawn-due-request-notif";
import type { DueDateRequest } from "@/modules/report_task/types";

const notif = (createdAt: string, byUserId = "u1") => ({
  kind: "task_due_request",
  byUserId,
  createdAt,
  message: 'สมชาย ขอเลื่อนกำหนดส่งงาน "A" จาก 20 ต.ค. เป็น 25 ต.ค. — ติดงาน',
});
const req = (requestedAt: string, status: DueDateRequest["status"], requestedBy = "u1"): DueDateRequest => ({
  id: `r-${requestedAt}`,
  requestedBy,
  requestedAt,
  newDate: "2026-10-25",
  previousDate: "2026-10-20",
  reason: "ติดงาน",
  status,
});

describe("ซ่อนแจ้งเตือนขอเลื่อนที่ถูกถอน", () => {
  it("คำขอยังค้าง = แสดง", () => {
    expect(isWithdrawnDueRequestNotification(notif("2026-10-19T03:00:00.010Z"), [req("2026-10-19T03:00:00.000Z", "pending")])).toBe(false);
  });
  it("คนขอยกเลิก = ซ่อน", () => {
    expect(isWithdrawnDueRequestNotification(notif("2026-10-19T03:00:00.010Z"), [req("2026-10-19T03:00:00.000Z", "cancelled")])).toBe(true);
  });
  it("ขอใหม่แทน — แจ้งเตือนของคำขอเก่าซ่อน ของคำขอใหม่แสดง", () => {
    const requests = [req("2026-10-19T04:00:00.000Z", "pending")];
    expect(isWithdrawnDueRequestNotification(notif("2026-10-19T03:00:00.010Z"), requests)).toBe(true);
    expect(isWithdrawnDueRequestNotification(notif("2026-10-19T04:00:00.010Z"), requests)).toBe(false);
  });
  it("อนุมัติ/ไม่อนุมัติแล้ว ยังแสดง (เป็นประวัติ)", () => {
    expect(isWithdrawnDueRequestNotification(notif("2026-10-19T03:00:00.010Z"), [req("2026-10-19T03:00:00.000Z", "approved")])).toBe(false);
    expect(isWithdrawnDueRequestNotification(notif("2026-10-19T03:00:00.010Z"), [req("2026-10-19T03:00:00.000Z", "rejected")])).toBe(false);
  });
  it("แจ้งเตือนผลอนุมัติ (ไม่ใช่ข้อความขอเลื่อน) ไม่แตะ", () => {
    const n = { ...notif("2026-10-19T03:00:00.010Z"), message: 'หัวหน้า อนุมัติให้เลื่อนกำหนดส่งงาน "A" เป็น 25 ต.ค.' };
    expect(isWithdrawnDueRequestNotification(n, [])).toBe(false);
  });
});
