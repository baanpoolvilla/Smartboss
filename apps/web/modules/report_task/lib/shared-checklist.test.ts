import { beforeEach, describe, expect, it } from "vitest";

import { canToggleOwnChecklistItem } from "@/modules/report_task/lib/permissions";
import { deriveCompletedAssigneeIds, isTaskFullyDone } from "@/modules/report_task/lib/task-completion";
import { sweepAutoPenalties } from "@/modules/report_task/lib/task-penalty-sweep";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, User } from "@/modules/report_task/types";

/** "ช่วยกันทำ" — เช็คลิสต์ไม่แยกคน ใครในงานติ๊กข้อไหนก็ได้ ครบทุกข้อ = ทุกคนเสร็จ · เลยกำหนด = หักทุกคน */
const BOSS = "boss";
const A = "a";
const B = "b";
const people: User[] = [
  { id: BOSS, name: "Os", email: "o@x", avatar: "O", role: "CEO", departmentId: "d1", isOwner: true },
  { id: A, name: "Bee", email: "a@x", avatar: "B", role: "พนักงาน", departmentId: "d1" },
  { id: B, name: "Aui", email: "b@x", avatar: "A", role: "พนักงาน", departmentId: "d1" },
];
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function sharedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "ช่วยกัน",
    description: "",
    status: "in_progress",
    priority: "medium",
    taskMode: "group",
    completionRule: "shared",
    assigneeIds: [A, B],
    assignedById: BOSS,
    departmentIds: ["d1"],
    startDate: `${day(-2)}T00:00:00.000Z`,
    dueDate: `${day(3)}T00:00:00.000Z`,
    originalDueDate: `${day(3)}T00:00:00.000Z`,
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [
      { id: "c1", text: "หนึ่ง", done: false },
      { id: "c2", text: "สอง", done: false },
    ],
    showChecklistOnCard: false,
    createdAt: `${day(-2)}T00:00:00.000Z`,
    updatedAt: `${day(-2)}T00:00:00.000Z`,
    ...overrides,
  } as Task;
}
const getTask = () => useTaskStore.getState().tasks.find((t) => t.id === "t1")!;

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useNotificationStore.setState({ notifications: [] });
});

describe("ช่วยกันทำ", () => {
  it("ใครในงานก็ติ๊กได้ทุกข้อ · คนนอกงานติ๊กไม่ได้", () => {
    const t = sharedTask();
    expect(canToggleOwnChecklistItem(t.checklist[0]!, A, t)).toBe(true);
    expect(canToggleOwnChecklistItem(t.checklist[1]!, B, t)).toBe(true);
    expect(canToggleOwnChecklistItem(t.checklist[0]!, "someone-else", t)).toBe(false);
  });

  it("ติ๊กยังไม่ครบ = ยังไม่มีใครเสร็จ · ครบทุกข้อ = ทุกคนเสร็จ", () => {
    expect(deriveCompletedAssigneeIds([A, B], [{ id: "1", text: "", done: true }, { id: "2", text: "", done: false }], [], "shared")).toEqual([]);
    expect(isTaskFullyDone([A, B], [{ id: "1", text: "", done: true }, { id: "2", text: "", done: true }], "shared")).toBe(true);
  });

  it("A ติ๊กข้อหนึ่ง B ติ๊กอีกข้อ ⇒ งานเสร็จ ทุกคนเสร็จ", () => {
    useTaskStore.setState({ tasks: [sharedTask()] });
    useIdentityStore.setState({ viewingAsUserId: A });
    useTaskStore.getState().toggleChecklistItem("t1", "c1");
    expect(getTask().status).toBe("in_progress");
    useIdentityStore.setState({ viewingAsUserId: B });
    useTaskStore.getState().toggleChecklistItem("t1", "c2");
    expect(getTask().status).toBe("done");
    expect(getTask().completedAssigneeIds).toEqual([A, B]);
  });

  it("เลยกำหนดแล้วยังไม่ครบ ⇒ หักทุกคน", () => {
    const late = sharedTask({ dueDate: `${day(-1)}T00:00:00.000Z`, originalDueDate: `${day(-1)}T00:00:00.000Z` });
    const swept = sweepAutoPenalties([late]).tasks[0]!;
    expect(Object.keys(swept.penalties ?? {}).sort()).toEqual([A, B].sort());
  });
});
