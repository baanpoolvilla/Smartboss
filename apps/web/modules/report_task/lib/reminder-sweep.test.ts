import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeReminders } from "@/modules/report_task/lib/reminder-sweep";
import { defaultReminderSettings, type ReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { CalendarEvent, Task } from "@/modules/report_task/types";

/**
 * "สร้างงานแล้วแจ้งซ้ำ 2 รอบ" — งานที่สร้างตอนเหลือ 9 ชม. อยู่ในทั้งช่วงเตือน 3 วันและ 1 วันพร้อมกัน
 * ต้องได้แจ้งเตือนครั้งเดียว และรอบถัดไปไม่เตือนซ้ำ
 */
const NOW = new Date("2026-09-30T14:59:00");

function task(): Task {
  return {
    id: "t1",
    title: "test",
    description: "",
    status: "todo",
    priority: "medium",
    taskMode: "individual",
    assigneeIds: ["u1"],
    assignedById: "boss",
    departmentIds: [],
    startDate: "2026-09-30T00:00:00.000Z",
    dueDate: "2026-09-30T00:00:00.000Z",
    originalDueDate: "2026-09-30T00:00:00.000Z",
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [],
    showChecklistOnCard: false,
    createdAt: "2026-09-30T05:58:00.000Z",
    updatedAt: "2026-09-30T05:58:00.000Z",
  } as Task;
}

function run(opts: { alreadySent?: Set<string>; settings?: Partial<ReminderSettings>; meetings?: CalendarEvent[]; tasks?: Task[] } = {}) {
  return computeReminders({
    tasks: opts.tasks ?? [task()],
    meetings: opts.meetings ?? [],
    todos: [],
    topics: [],
    posts: [],
    settings: { ...defaultReminderSettings, ...opts.settings },
    alreadySent: opts.alreadySent ?? new Set(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("แจ้งเตือนใกล้ถึงกำหนดส่ง", () => {
  it("อยู่ในหลายช่วงพร้อมกัน (3 วัน + 1 วัน) = เตือนครั้งเดียว", () => {
    const result = run();
    const taskNotes = result.notifications.filter((n) => n.message.includes('งาน "test"'));
    expect(taskNotes).toHaveLength(1);
    expect(taskNotes[0]!.message).toContain("อีก 9 ชม.");
    // ทั้งสองช่วงถูกบันทึกว่าส่งแล้ว — ช่วง 3 วันจะไม่โผล่มาทีหลัง
    expect(result.newSentKeys).toEqual(expect.arrayContaining(["task:t1:1440", "task:t1:4320"]));
  });

  it("รอบถัดไปไม่เตือนซ้ำ", () => {
    const first = run();
    const second = run({ alreadySent: new Set(first.newSentKeys) });
    expect(second.notifications).toHaveLength(0);
    expect(second.newSentKeys).toHaveLength(0);
  });

  it("เพิ่มช่วงใหม่ที่เลยไปแล้วในตั้งค่า = บันทึกเฉย ๆ ไม่เตือนย้อนหลัง", () => {
    const result = run({ alreadySent: new Set(["task:t1:1440"]) });
    expect(result.notifications).toHaveLength(0);
    expect(result.newSentKeys).toEqual(["task:t1:4320"]);
  });

  it("ยังไม่เข้าช่วงใกล้สุด แต่อยู่ในช่วงใหญ่ = เตือนตามช่วงใหญ่ครั้งเดียว", () => {
    const later = { ...task(), dueDate: "2026-10-02T00:00:00.000Z" }; // เหลือ ~2 วัน: อยู่ในช่วง 3 วัน ไม่อยู่ในช่วง 1 วัน
    const result = run({ tasks: [later] });
    expect(result.notifications).toHaveLength(1);
    expect(result.newSentKeys).toEqual(["task:t1:4320"]);
  });

  it("ประชุมตั้งหลายช่วง (30 + 15 นาที) ตอนเหลือ 10 นาที = เตือนครั้งเดียว", () => {
    const meeting = { id: "m1", title: "ประชุม", start: new Date(NOW.getTime() + 10 * 60_000).toISOString(), attendeeIds: ["u1"] } as CalendarEvent;
    const result = run({
      tasks: [],
      meetings: [meeting],
      settings: { meeting: { ...defaultReminderSettings.meeting, leadMinutes: [30, 15] } },
    });
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]!.message).toContain("15 นาที");
    expect(result.newSentKeys).toEqual(expect.arrayContaining(["meeting:m1:15", "meeting:m1:30"]));
  });
});
