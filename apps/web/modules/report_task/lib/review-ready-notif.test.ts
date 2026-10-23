import { beforeEach, describe, expect, it } from "vitest";

import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, User } from "@/modules/report_task/types";

/**
 * งานเข้า "รอตรวจ" — แจ้งผู้มอบหมาย (+หัวหน้า/ผู้ตรวจเพิ่มเติมตามตั้งค่า)
 * CEO ได้แจ้งเฉพาะงานที่ตัวเองมอบหมาย ("งานที่พี่ไม่ได้มอบหมาย ทำไมยังเตือน ceo" 23/10/2569)
 * แต่ยังกดผ่าน/ไม่ผ่านได้ทุกงานเหมือนเดิม · งานที่ไม่มีใครอื่นจะได้แจ้ง → CEO ได้แจ้ง (ไม่ให้งานค้างเงียบ)
 */
const CEO = "ceo";
const STAFF = "staff";
const BOSS = "assigner";

const people: User[] = [
  { id: CEO, name: "Nam", email: "ceo@x", avatar: "N", role: "CEO", departmentId: "d1", isOwner: true },
  { id: STAFF, name: "Sujita", email: "s@x", avatar: "S", role: "พนักงาน", departmentId: "d1" },
  { id: BOSS, name: "Chayanun", email: "p@x", avatar: "C", role: "พนักงาน", departmentId: "d1" },
];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "ตรวจสอบค่าน้ำผิดปกติ HS1",
    description: "",
    status: "in_progress",
    priority: "medium",
    taskMode: "individual",
    assigneeIds: [STAFF],
    assignedById: BOSS,
    departmentIds: [],
    startDate: "2026-10-20T00:00:00.000Z",
    dueDate: "2026-10-24T00:00:00.000Z",
    originalDueDate: "2026-10-24T00:00:00.000Z",
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [],
    showChecklistOnCard: false,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  } as Task;
}

const forUser = (id: string) => useNotificationStore.getState().notifications.filter((n) => n.userId === id && n.message.includes("รอคุณตรวจ"));

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useNotificationStore.setState({ notifications: [] });
  useIdentityStore.setState({ viewingAsUserId: STAFF });
});

describe("งานส่งรอตรวจ — ใครได้แจ้งเตือน", () => {
  it("คนอื่นมอบหมาย → ผู้มอบหมายได้แจ้ง · CEO ไม่ได้", () => {
    useTaskStore.setState({ tasks: [task()] });
    useTaskStore.getState().moveTask("t1", "done");
    expect(forUser(BOSS)).toHaveLength(1);
    expect(forUser(CEO)).toHaveLength(0);
  });

  it("CEO มอบหมายเอง → CEO ได้แจ้ง", () => {
    useTaskStore.setState({ tasks: [task({ assignedById: CEO })] });
    useTaskStore.getState().moveTask("t1", "done");
    expect(forUser(CEO)).toHaveLength(1);
  });

  it("ไม่มีผู้มอบหมาย/หัวหน้า/ผู้ตรวจเลย → CEO ได้แจ้ง (งานไม่ค้างเงียบ)", () => {
    useTaskStore.setState({ tasks: [task({ assignedById: "" })] });
    useTaskStore.getState().moveTask("t1", "done");
    expect(forUser(CEO)).toHaveLength(1);
  });
});
