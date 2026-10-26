import { beforeEach, describe, expect, it } from "vitest";

import { sweepAutoPenalties } from "@/modules/report_task/lib/task-penalty-sweep";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
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
  beforeEach(() => useTaskStore.setState({ reopenRequest: null }));

  it("เปลี่ยนสถานะกลับ หลังกำหนดผ่านไป ⇒ ยังไม่เปิด รอเลือกวันใหม่ก่อน", () => {
    useTaskStore.setState({ tasks: [doneTask()] });
    useTaskStore.getState().moveTask("t1", "in_progress");
    expect(getTask().status).toBe("done");
    expect(useTaskStore.getState().reopenRequest).toEqual({ taskId: "t1", status: "in_progress" });
  });

  it("ยังไม่เลยกำหนด ⇒ เปิดได้ตรง ๆ เหมือนเดิม", () => {
    useTaskStore.setState({ tasks: [doneTask({ dueDate: iso(day(3)), originalDueDate: iso(day(3)) })] });
    useTaskStore.getState().moveTask("t1", "in_progress");
    expect(getTask().status).toBe("in_progress");
    expect(useTaskStore.getState().reopenRequest).toBeNull();
  });

  it("ตั้งวันใหม่ผ่านส่งกลับให้แก้ไข ⇒ เปิดงาน ไม่โดนหัก", () => {
    useTaskStore.setState({ tasks: [doneTask()] });
    useTaskStore.getState().reviseDueDate("t1", iso(day(5)), "ขาดอีกอัน", BOSS, true);
    const t = getTask();
    expect(t.status).toBe("in_progress");
    expect(sweepAutoPenalties([t]).tasks[0]!.penalty).toBeFalsy();
  });

  it("เอาติ๊กเช็คลิสต์ออก ⇒ ได้ถึงสิ้นวันนี้ ไม่โดนหักทันที", () => {
    useTaskStore.setState({
      tasks: [doneTask({ checklist: [{ id: "c1", text: "x", done: true, ownerId: A }] })],
    });
    useIdentityStore.setState({ viewingAsUserId: A });
    useTaskStore.getState().toggleChecklistItem("t1", "c1");
    const t = getTask();
    expect(t.status).toBe("in_progress");
    expect(sweepAutoPenalties([t]).tasks[0]!.penalty).toBeFalsy();
  });
});
