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

describe("แจ้งเตือนงานใกล้ครบกำหนด — เตือนตอนเช้า ไม่ใช่เที่ยงคืน", () => {
  // งานครบกำหนด 2 ต.ค. (ไม่มีเวลา) · สร้างไว้ตั้งแต่ 25 ก.ย. · ค่าเริ่มต้น: 3 วัน + 1 วันก่อน + เช้าวันครบกำหนด เวลา 08:30
  const due = (over: Partial<Task> = {}) =>
    ({ ...task(), dueDate: "2026-10-02", originalDueDate: "2026-10-02", createdAt: new Date("2026-09-25T09:00:00").toISOString(), ...over }) as Task;
  const at = (local: string, opts: Parameters<typeof run>[0] = {}) => {
    vi.setSystemTime(new Date(local));
    return run({ tasks: [due()], ...opts });
  };
  const taskMsgs = (r: ReturnType<typeof run>) => r.notifications.filter((n) => n.message.startsWith('งาน "test"')).map((n) => n.message);

  it("เที่ยงคืนไม่เด้ง — รอบ 3 วันก่อนเลยมานานแล้ว บันทึกเฉย ๆ", () => {
    const r = at("2026-10-01T00:05:00");
    expect(taskMsgs(r)).toEqual([]);
    expect(r.newSentKeys).toEqual(["taskr:t1:2026-10-02T:d3"]);
  });

  it("08:30 วันก่อนครบกำหนด → \"ครบกำหนดพรุ่งนี้\" บอกวันที่ด้วย", () => {
    const r = at("2026-10-01T08:31:00", { alreadySent: new Set(["taskr:t1:2026-10-02T:d3"]) });
    expect(taskMsgs(r)).toHaveLength(1);
    expect(taskMsgs(r)[0]).toMatch(/^งาน "test" ครบกำหนดพรุ่งนี้ \(.*2.*\)$/);
    expect(r.notifications[0]!.recipients).toEqual(["u1"]);
  });

  it("ยังไม่ถึงเวลาเช้า (08:29) = ยังไม่เตือน", () => {
    expect(taskMsgs(at("2026-10-01T08:29:00", { alreadySent: new Set(["taskr:t1:2026-10-02T:d3"]) }))).toEqual([]);
  });

  it("เช้าวันครบกำหนด → \"ครบกำหนดวันนี้\" · รอบถัดไปไม่เตือนซ้ำ", () => {
    const first = at("2026-10-02T09:00:00", { alreadySent: new Set(["taskr:t1:2026-10-02T:d3", "taskr:t1:2026-10-02T:d1"]) });
    expect(taskMsgs(first)).toEqual(['งาน "test" ครบกำหนดวันนี้']);
    const again = at("2026-10-02T09:01:00", { alreadySent: new Set(["taskr:t1:2026-10-02T:d3", "taskr:t1:2026-10-02T:d1", ...first.newSentKeys]) });
    expect(again.notifications).toHaveLength(0);
    expect(again.newSentKeys).toHaveLength(0);
  });

  it("3 วันก่อน → \"ครบกำหนดอีก 3 วัน\"", () => {
    expect(taskMsgs(at("2026-09-29T08:30:00"))[0]).toMatch(/^งาน "test" ครบกำหนดอีก 3 วัน \(/);
  });

  it("เลยเวลาเช้าไปเกิน 6 ชม. (ไม่มีใครเปิดเว็บทั้งวัน) = ไม่เตือนย้อนหลังตอนดึก", () => {
    expect(taskMsgs(at("2026-10-01T15:00:00", { alreadySent: new Set(["taskr:t1:2026-10-02T:d3"]) }))).toEqual([]);
  });

  it("สร้างงานหลังรอบเช้าไปแล้ว = ไม่เตือนทันทีตอนสร้าง", () => {
    vi.setSystemTime(new Date("2026-10-02T10:00:00"));
    const r = run({ tasks: [due({ createdAt: new Date("2026-10-02T09:55:00").toISOString() })] });
    expect(taskMsgs(r)).toEqual([]);
  });

  it("ตั้งเวลาเตือนเองได้ (07:00)", () => {
    const settings = { task: { ...defaultReminderSettings.task, morningTime: "07:00" } };
    expect(taskMsgs(at("2026-10-01T06:59:00", { settings, alreadySent: new Set(["taskr:t1:2026-10-02T:d3"]) }))).toEqual([]);
    expect(taskMsgs(at("2026-10-01T07:00:00", { settings, alreadySent: new Set(["taskr:t1:2026-10-02T:d3"]) }))).toHaveLength(1);
  });

  it("ปิดเตือนวันครบกำหนด = ไม่มี \"ครบกำหนดวันนี้\"", () => {
    const settings = { task: { ...defaultReminderSettings.task, remindOnDueDay: false } };
    expect(taskMsgs(at("2026-10-02T09:00:00", { settings, alreadySent: new Set(["taskr:t1:2026-10-02T:d3", "taskr:t1:2026-10-02T:d1"]) }))).toEqual([]);
  });

  it("งานที่ใส่เวลาส่ง + จุด 2 ชม. → เตือนก่อนเวลาส่ง 2 ชม.", () => {
    const settings = { task: { ...defaultReminderSettings.task, leadMinutes: [1440, 120] } };
    vi.setSystemTime(new Date("2026-10-02T14:01:00"));
    const r = run({ tasks: [due({ dueTime: "16:00" })], settings, alreadySent: new Set(["taskr:t1:2026-10-02T16:00:d1", "taskr:t1:2026-10-02T16:00:d0"]) });
    expect(taskMsgs(r)).toEqual(['งาน "test" ครบกำหนดอีก 2 ชม. (16:00 น.)']);
  });

  it("จุดชั่วโมงไม่ใช้กับงานที่ไม่มีเวลาส่ง (ไม่งั้นนับถึง 23:59 ได้เวลากลางดึก)", () => {
    const settings = { task: { ...defaultReminderSettings.task, leadMinutes: [120] } };
    expect(taskMsgs(at("2026-10-02T22:00:00", { settings, alreadySent: new Set(["taskr:t1:2026-10-02T:d0"]) }))).toEqual([]);
  });

  it("เลื่อนกำหนดส่ง = นับรอบใหม่ของวันใหม่", () => {
    vi.setSystemTime(new Date("2026-10-01T08:31:00"));
    const moved = due({ dueDate: "2026-10-02" });
    const r = run({ tasks: [moved], alreadySent: new Set(["taskr:t1:2026-09-30T:d0", "taskr:t1:2026-09-30T:d1", "taskr:t1:2026-10-02T:d3"]) });
    expect(taskMsgs(r)).toHaveLength(1);
  });

  it("งานส่วนตัว (เปิดให้ตัวเอง) เตือนเจ้าของคนเดียวเสมอ แม้ปิดการเตือนผู้รับงาน", () => {
    vi.setSystemTime(new Date("2026-10-02T09:00:00"));
    const personal = due({ assigneeIds: ["u1"], assignedById: "u1" });
    const r = run({
      tasks: [personal],
      settings: { task: { ...defaultReminderSettings.task, notifyAssignee: false, notifyAssigner: false, notifyDeptHead: true } },
    });
    expect(r.notifications.filter((n) => n.message.includes('งาน "test"')).map((n) => n.recipients)).toEqual([["u1"]]);
  });

  it("ไม่เตือนคนมอบหมายงาน แม้ตั้งค่าเดิมเปิดไว้ — เตือนเฉพาะผู้รับผิดชอบ", () => {
    vi.setSystemTime(new Date("2026-10-02T09:00:00"));
    const r = run({ tasks: [due()], settings: { task: { ...defaultReminderSettings.task, notifyAssignee: true, notifyAssigner: true } } });
    expect(r.notifications.map((n) => n.recipients)).toEqual([["u1"]]);
  });

  it("คนมอบหมายที่เป็นผู้รับผิดชอบด้วย ยังได้เตือน", () => {
    vi.setSystemTime(new Date("2026-10-02T09:00:00"));
    const r = run({ tasks: [due({ assigneeIds: ["u1", "boss"] })] });
    expect(r.notifications[0]!.recipients.sort()).toEqual(["boss", "u1"]);
  });

  it("งานเสร็จแล้ว / เลยกำหนดแล้ว = ไม่เตือน", () => {
    vi.setSystemTime(new Date("2026-10-02T09:00:00"));
    expect(run({ tasks: [due({ status: "done" })] }).notifications).toHaveLength(0);
    vi.setSystemTime(new Date("2026-10-03T09:00:00"));
    expect(run({ tasks: [due()] }).notifications).toHaveLength(0);
  });
});

describe("ประชุม", () => {
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

// ผู้ใช้ขอ 20/10/2569 — งานเสร็จแล้วค้าง "รอตรวจสอบ" ครบ 2 เดือน → เตือนคนที่เปิดงานให้
describe("เตือนงานรอตรวจค้างเกิน 2 เดือน", () => {
  const DAY = 86_400_000;
  const doneTask = (over: Partial<Task> = {}): Task =>
    ({ ...task(), id: "d1", title: "งานเสร็จ", status: "done", completedAt: new Date(NOW.getTime() - 61 * DAY).toISOString(), ...over }) as Task;
  const stale = (r: ReturnType<typeof run>) => r.notifications.filter((n) => n.message.includes("ยังรอคุณตรวจ"));

  it("เสร็จครบ 60 วัน ยังไม่ตรวจ → เตือนคนที่เปิดงานให้ ครั้งเดียว", () => {
    const r = run({ tasks: [doneTask()] });
    expect(stale(r)).toHaveLength(1);
    expect(stale(r)[0]!.recipients).toEqual(["boss"]);
    expect(stale(r)[0]!.message).toContain('งาน "งานเสร็จ"');
    expect(stale(r)[0]!.message).toMatch(/ทำเสร็จตั้งแต่ \d{2}\/\d{2}\/25\d{2}/);
    expect(stale(r)[0]!.link).toBe("/report-task/tasks?task=d1");
    // รอบถัดไปไม่ซ้ำ
    expect(stale(run({ tasks: [doneTask()], alreadySent: new Set(r.newSentKeys) }))).toHaveLength(0);
  });

  it("ยังไม่ถึง 60 วัน / ตรวจแล้ว / งานส่วนตัว / เปิดให้ตัวเอง → ไม่เตือน", () => {
    const fresh = doneTask({ completedAt: new Date(NOW.getTime() - 59 * DAY).toISOString() });
    const reviewed = doneTask({ reviewedBy: "boss" });
    const personal = doneTask({ assigneeIds: ["u1"], assignedById: "u1" });
    const selfToo = doneTask({ assigneeIds: ["u1", "boss"] });
    expect(stale(run({ tasks: [fresh, reviewed, personal, selfToo] }))).toHaveLength(0);
  });

  it("ส่งกลับไปแก้แล้วเสร็จใหม่ = นับใหม่ เตือนใหม่ได้", () => {
    const first = run({ tasks: [doneTask()] });
    const again = doneTask({ completedAt: new Date(NOW.getTime() - 70 * DAY + 1000).toISOString() });
    expect(stale(run({ tasks: [again], alreadySent: new Set(first.newSentKeys) }))).toHaveLength(1);
  });

  it("คนเดียวมีหลายชิ้น (เกิน 3) → รวมเป็นแจ้งเตือนเดียว", () => {
    const many = [1, 2, 3, 4, 5].map((i) => doneTask({ id: `d${i}`, title: `งาน ${i}` }));
    const r = run({ tasks: many });
    expect(stale(r)).toHaveLength(1);
    expect(stale(r)[0]!.message).toContain("มีงาน 5 ชิ้น");
    expect(r.newSentKeys.filter((k) => k.startsWith("review-stale:"))).toHaveLength(5);
  });

  it("ปิดการเตือนงานในตั้งค่า → ไม่เตือน", () => {
    expect(stale(run({ tasks: [doneTask()], settings: { task: { ...defaultReminderSettings.task, enabled: false } } }))).toHaveLength(0);
  });
});
