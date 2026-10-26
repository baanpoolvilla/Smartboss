import { beforeEach, describe, expect, it } from "vitest";

import { sweepAutoPenalties } from "@/modules/report_task/lib/task-penalty-sweep";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, User } from "@/modules/report_task/types";

/**
 * เปิดงาน "เสร็จสิ้น" กลับมาทำ — เจอจริง BT5-Trip-Khwan: ส่งทัน 24/10 หัวหน้าเปลี่ยนสถานะกลับเป็น
 * "กำลังทำ" 26/10 แล้วเลื่อนเป็น 31/10 ⇒ sweep หัก −3 ทันที (เทียบกับ 24/10) ทั้งที่ไม่ได้ช้า
 */
const BOSS = "boss";
const A = "a";

const people: User[] = [
  { id: BOSS, name: "Os", email: "o@x", avatar: "O", role: "CEO", departmentId: "d1", isOwner: true },
  { id: A, name: "Aui", email: "a@x", avatar: "A", role: "พนักงาน", departmentId: "d1" },
];

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const iso = (d: string) => `${d}T00:00:00.000Z`;

function doneTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "BT5-Trip-Khwan",
    description: "",
    status: "done",
    priority: "low",
    taskMode: "individual",
    assigneeIds: [A],
    assignedById: BOSS,
    departmentIds: ["d1"],
    startDate: iso(day(-5)),
    dueDate: iso(day(-2)),
    originalDueDate: iso(day(-2)),
    completedAssigneeIds: [A],
    completedAt: iso(day(-3)),
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [],
    showChecklistOnCard: false,
    createdAt: iso(day(-5)),
    updatedAt: iso(day(-3)),
    ...overrides,
  } as Task;
}

const getTask = () => useTaskStore.getState().tasks.find((t) => t.id === "t1")!;

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useNotificationStore.setState({ notifications: [] });
});

describe("เปิดงานที่ส่งทันแล้วกลับมาทำ", () => {
  it("เปลี่ยนสถานะกลับ หลังกำหนดผ่านไป ⇒ ไม่โดนหักวันนี้", () => {
    useTaskStore.setState({ tasks: [doneTask()] });
    useTaskStore.getState().moveTask("t1", "in_progress");
    const swept = sweepAutoPenalties([getTask()]).tasks[0]!;
    expect(swept.penalty).toBeFalsy();
    expect(swept.missedDeadlineOnce).toBeFalsy();
  });

  it("เปิดกลับแล้วเลื่อนกำหนดวันเดียวกัน ⇒ ยึดวันใหม่ ไม่โดนหัก", () => {
    useTaskStore.setState({ tasks: [doneTask()] });
    useTaskStore.getState().moveTask("t1", "in_progress");
    useTaskStore.getState().reviseDueDate("t1", iso(day(5)), "ขาดอีกอัน", BOSS, false);
    const swept = sweepAutoPenalties([getTask()]).tasks[0]!;
    expect(swept.penalty).toBeFalsy();
  });

  it("ส่งช้าอยู่แล้ว เปิดกลับ ⇒ ยังโดนหักเหมือนเดิม", () => {
    useTaskStore.setState({ tasks: [doneTask({ completedAt: iso(day(-1)), missedDeadlineOnce: true })] });
    useTaskStore.getState().moveTask("t1", "in_progress");
    const swept = sweepAutoPenalties([getTask()]).tasks[0]!;
    expect(swept.penalty?.points).toBeGreaterThan(0);
  });
});
