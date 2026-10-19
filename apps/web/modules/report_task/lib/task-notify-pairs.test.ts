import { beforeEach, describe, expect, it } from "vitest";

import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, User } from "@/modules/report_task/types";

/** หนึ่งการกด = แจ้งเตือนหนึ่งอันต่อคน (ผู้ใช้ขอ 19/10/2569 "เช็คเรื่องการแจ้งเตือนงานด้านใน task") */
const STAFF = "staff";
const BOSS = "assigner";
const people: User[] = [
  { id: STAFF, name: "Bunny", email: "s@x", avatar: "B", role: "พนักงาน", departmentId: "d1" },
  { id: BOSS, name: "Pim", email: "p@x", avatar: "P", role: "พนักงาน", departmentId: "d1" },
];

const task = (): Task =>
  ({
    id: "t1",
    title: "HS3",
    description: "",
    status: "in_progress",
    priority: "medium",
    taskMode: "individual",
    assigneeIds: [STAFF],
    assignedById: BOSS,
    departmentIds: [],
    startDate: "2026-10-01T00:00:00.000Z",
    dueDate: "2026-10-30T00:00:00.000Z",
    originalDueDate: "2026-10-30T00:00:00.000Z",
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [
      { id: "c1", text: "เช็คปั๊ม", done: false, ownerId: STAFF },
      { id: "c2", text: "เก็บเงิน", done: false, ownerId: STAFF },
    ],
    showChecklistOnCard: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  }) as Task;

const forBoss = () => useNotificationStore.getState().notifications.filter((n) => n.userId === BOSS);

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useIdentityStore.setState({ viewingAsUserId: STAFF });
  useNotificationStore.setState({ notifications: [] });
  useTaskStore.setState({ tasks: [task()] });
});

describe("แจ้งเตือนในงานไม่มาเป็นคู่", () => {
  it("ติ๊กข้อที่ยังไม่ครบ = คนมอบหมายได้ 'ทำ … ในเช็คลิสต์' อันเดียว", () => {
    useTaskStore.getState().toggleChecklistItem("t1", "c1");
    expect(forBoss()).toHaveLength(1);
    expect(forBoss()[0]!.message).toContain("ในเช็คลิสต์");
  });

  it("ติ๊กข้อสุดท้าย (งานปิดเอง) = ได้แค่ 'ส่งงาน … รอคุณตรวจ' ไม่มี 'ทำ … ในเช็คลิสต์' คู่กัน", () => {
    useTaskStore.getState().toggleChecklistItem("t1", "c1");
    useNotificationStore.setState({ notifications: [] });
    useTaskStore.getState().toggleChecklistItem("t1", "c2");
    expect(forBoss()).toHaveLength(1);
    expect(forBoss()[0]!.message).toContain("รอคุณตรวจ");
  });
});
