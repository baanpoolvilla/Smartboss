import { beforeEach, describe, expect, it } from "vitest";

import { sweepAutoPenalties } from "@/modules/report_task/lib/task-penalty-sweep";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, User } from "@/modules/report_task/types";

/**
 * "ไม่ผ่าน" ของงานกลุ่ม — เจอจริง T-2569-0028: ทั้งสองคนส่งทันวันรายคน (02/10, 05/10) หัวหน้า
 * ตรวจทีหลังแล้วกดไม่ผ่านเลื่อนเป็น 30/10 แต่ rejectReview เปลี่ยนแค่ dueDate ของทั้งงาน ⇒ งาน
 * เปิดกลับมา sweep เห็นวันรายคนเดิมเลยไปแล้ว หักคนละ −3 และประวัติรอบนั้นไม่ขึ้น
 */
const BOSS = "boss";
const A = "a";
const B = "b";

const people: User[] = [
  { id: BOSS, name: "Os", email: "o@x", avatar: "O", role: "CEO", departmentId: "d1", isOwner: true },
  { id: A, name: "Kanitha", email: "a@x", avatar: "K", role: "พนักงาน", departmentId: "d1" },
  { id: B, name: "Chayanun", email: "b@x", avatar: "C", role: "พนักงาน", departmentId: "d1" },
];

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function groupTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "สไลด์เดอร์",
    description: "",
    status: "done",
    priority: "medium",
    taskMode: "group",
    completionRule: "all",
    assigneeIds: [A, B],
    assignedById: BOSS,
    departmentIds: ["d1"],
    startDate: `${day(-30)}T00:00:00.000Z`,
    dueDate: `${day(-16)}T00:00:00.000Z`,
    originalDueDate: `${day(-16)}T00:00:00.000Z`,
    // วันรายคนที่เลื่อนไว้ก่อนส่ง — ส่งทันทั้งคู่ แต่ตอนตรวจวันพวกนี้ผ่านไปแล้ว
    assigneeDueDates: { [A]: day(-6), [B]: day(-9) },
    completedAssigneeIds: [A, B],
    completedAt: `${day(-10)}T00:00:00.000Z`,
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [
      { id: "c1", text: "ของ A", done: true, ownerId: A },
      { id: "c2", text: "ของ B", done: true, ownerId: B },
    ],
    showChecklistOnCard: false,
    createdAt: `${day(-30)}T00:00:00.000Z`,
    updatedAt: `${day(-10)}T00:00:00.000Z`,
    ...overrides,
  } as Task;
}

const getTask = () => useTaskStore.getState().tasks.find((t) => t.id === "t1")!;
const iso = (d: string) => new Date(d).toISOString();

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useNotificationStore.setState({ notifications: [] });
  useTaskStore.setState({ tasks: [groupTask()] });
});

describe("ไม่ผ่าน — งานกลุ่ม", () => {
  it("วันเดียวกันทุกคน: วันรายคนเลื่อนตาม ไม่โดนหักคะแนน และประวัติขึ้นรายคน", () => {
    const newDay = day(20);
    useTaskStore.getState().rejectReview("t1", iso(newDay), "ขอราคาเพิ่ม", BOSS);
    const t = getTask();
    expect(t.status).toBe("in_progress");
    expect(t.assigneeDueDates).toEqual({ [A]: newDay, [B]: newDay });
    expect(t.assigneeDueDateRevisions?.[A]).toMatchObject({ latestDate: newDay, revisedBy: BOSS });
    expect(t.assigneeDueDateRevisions?.[B]).toMatchObject({ latestDate: newDay, revisedBy: BOSS });
    expect(t.completedAssigneeIds).toEqual([]);

    const swept = sweepAutoPenalties([t]).tasks[0]!;
    expect(swept.penalties ?? {}).toEqual({});
    expect(swept.missedDeadlineOnce).toBeFalsy();
  });

  it("ปิดเมื่อครบทุกคน: ส่งกลับเฉพาะคนที่เลือก คนที่ผ่านยังนับว่าเสร็จ", () => {
    const newDay = day(10);
    useTaskStore.getState().rejectReview("t1", iso(newDay), "ราคาไม่ครบ", BOSS, { [A]: newDay });
    const t = getTask();
    expect(t.status).toBe("in_progress");
    expect(t.completedAssigneeIds).toEqual([B]);
    expect(t.assigneeDueDates).toEqual({ [A]: newDay, [B]: day(-9) });
    expect(t.checklist.find((c) => c.id === "c1")!.done).toBe(false);
    expect(t.checklist.find((c) => c.id === "c2")!.done).toBe(true);
    // แจ้งเฉพาะคนที่ต้องแก้
    const notified = useNotificationStore.getState().notifications.map((n) => n.userId);
    expect(notified).toEqual([A]);

    const swept = sweepAutoPenalties([t]).tasks[0]!;
    expect(swept.penalties ?? {}).toEqual({});
  });

  it("กำหนดแยกรายคน: แต่ละคนได้วันของตัวเอง กำหนดของทั้งงาน = วันช้าสุด", () => {
    useTaskStore.getState().rejectReview("t1", iso(day(14)), "แก้ทั้งคู่", BOSS, { [A]: day(7), [B]: day(14) });
    const t = getTask();
    expect(t.assigneeDueDates).toEqual({ [A]: day(7), [B]: day(14) });
    expect(t.dueDate.slice(0, 10)).toBe(day(14));
  });

  it("ปิดเมื่อคนใดคนหนึ่งเสร็จ: ส่งกลับทุกคนเสมอ แม้เลือกมาแค่คนเดียว", () => {
    useTaskStore.setState({ tasks: [groupTask({ completionRule: "any", completedAssigneeIds: [A] })] });
    useTaskStore.getState().rejectReview("t1", iso(day(5)), "ยังไม่ได้", BOSS, { [A]: day(5) });
    const t = getTask();
    expect(t.completedAssigneeIds).toEqual([]);
    expect(t.assigneeDueDates).toEqual({ [A]: day(5), [B]: day(5) });
  });
});
