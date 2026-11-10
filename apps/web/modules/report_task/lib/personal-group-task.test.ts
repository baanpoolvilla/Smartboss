import { beforeEach, describe, expect, it } from "vitest";

import { isOthersPersonalTask, isPersonalTask } from "@/modules/report_task/lib/personal-task";
import { taskSchema } from "@/modules/report_task/lib/db/task-schema";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, User } from "@/modules/report_task/types";

/**
 * งานส่วนตัวแบบกลุ่ม (ผู้ใช้ 10/11/2569 "งานส่วนตัวทำเป็นกลุ่มได้ คนสร้างต้องทำด้วย แจ้งเตือนด้วย")
 * คนในงานเห็น/แจ้งเตือนกันเอง · คนนอกงาน (รวม CEO) ไม่เห็น ไม่ได้แจ้ง · ไม่นับคะแนน
 */
const ME = "me";
const FRIEND = "friend";
const CEO = "ceo";
const people: User[] = [
  { id: ME, name: "Nok", email: "n@x", avatar: "N", role: "พนักงาน", departmentId: "d1" },
  { id: FRIEND, name: "Ton", email: "t@x", avatar: "T", role: "พนักงาน", departmentId: "d1" },
  { id: CEO, name: "Boss", email: "c@x", avatar: "B", role: "CEO", departmentId: "d1", isOwner: true },
];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "ทำบัญชีบ้าน",
    description: "",
    status: "in_progress",
    priority: "medium",
    taskMode: "group",
    personalGroup: true,
    assigneeIds: [ME, FRIEND],
    assignedById: ME,
    departmentIds: ["d1"],
    startDate: "2026-09-01T00:00:00.000Z",
    dueDate: "2026-09-30T00:00:00.000Z",
    originalDueDate: "2026-09-30T00:00:00.000Z",
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [],
    showChecklistOnCard: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as Task;
}

const notifsFor = (id: string) => useNotificationStore.getState().notifications.filter((n) => n.userId === id);

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useNotificationStore.setState({ notifications: [] });
  useTaskStore.setState({ tasks: [] });
});

describe("งานส่วนตัวแบบกลุ่ม", () => {
  it("เป็นงานส่วนตัว (ไม่นับคะแนน) · คนในงานเห็น · คนนอก/CEO ไม่เห็น", () => {
    const t = task();
    expect(isPersonalTask(t)).toBe(true);
    expect(isOthersPersonalTask(t, ME)).toBe(false);
    expect(isOthersPersonalTask(t, FRIEND)).toBe(false);
    expect(isOthersPersonalTask(t, CEO)).toBe(true);
  });

  it("งานกลุ่มปกติที่คนสร้างอยู่ในงานด้วย ไม่ใช่งานส่วนตัว (ของเดิมไม่เปลี่ยน)", () => {
    const t = task({ personalGroup: undefined });
    expect(isPersonalTask(t)).toBe(false);
    expect(isOthersPersonalTask(t, CEO)).toBe(false);
  });

  it("บันทึกแล้วยังเป็นงานส่วนตัวแบบกลุ่ม (zod ไม่ตัดฟิลด์ทิ้ง)", () => {
    const parsed = taskSchema.parse(task());
    expect((parsed as { personalGroup?: boolean }).personalGroup).toBe(true);
  });

  it("สร้างงาน → เพื่อนในงานได้แจ้งเตือนมอบหมาย · CEO ไม่ได้", () => {
    useTaskStore.getState().addTask(task());
    expect(notifsFor(FRIEND)).toHaveLength(1);
    expect(notifsFor(CEO)).toHaveLength(0);
  });

  it("เพื่อนขอเลื่อน → คนสร้างได้แจ้ง · แท็ก CEO ในคอมเมนต์ไม่หลุดไปหา CEO", () => {
    useTaskStore.setState({ tasks: [task()] });
    useTaskStore.getState().requestDueDateChange("t1", FRIEND, "2026-10-05", "ติดธุระ");
    expect(notifsFor(ME).some((n) => n.message.includes("ขอเลื่อน"))).toBe(true);
    expect(notifsFor(CEO)).toHaveLength(0);
  });
});
