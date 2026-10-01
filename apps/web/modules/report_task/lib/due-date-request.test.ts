import { beforeEach, describe, expect, it } from "vitest";

import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import type { Task, User } from "@/modules/report_task/types";

/**
 * คำขอเลื่อนกำหนดส่ง: ผู้รับผิดชอบขอ → CEO ได้แจ้งเตือน → อนุมัติ (วันเปลี่ยนจริง) / ไม่อนุมัติ (วันเดิม)
 * แจ้งผลกลับผู้ขอทั้งสองกรณี — วันที่ผิดตรงนี้กระทบคะแนน (ตัวหักงานเลยกำหนดอ่าน dueDate)
 */
const CEO = "ceo";
const STAFF = "staff";
const BOSS = "assigner";

const people: User[] = [
  { id: CEO, name: "Nam", email: "ceo@x", avatar: "N", role: "CEO", departmentId: "d1", isOwner: true },
  { id: STAFF, name: "Bunny", email: "s@x", avatar: "B", role: "พนักงาน", departmentId: "d1" },
  { id: BOSS, name: "Pim", email: "p@x", avatar: "P", role: "พนักงาน", departmentId: "d1" },
];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "คู่มือ Guidebook",
    description: "",
    status: "in_progress",
    priority: "medium",
    taskMode: "individual",
    assigneeIds: [STAFF],
    assignedById: BOSS,
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

const getTask = () => useTaskStore.getState().tasks.find((t) => t.id === "t1")!;
const notificationsFor = (userId: string) => useNotificationStore.getState().notifications.filter((n) => n.userId === userId);

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useNotificationStore.setState({ notifications: [] });
  useTaskStore.setState({ tasks: [task()] });
});

describe("คำขอเลื่อนกำหนดส่ง", () => {
  it("ขอแล้วรออนุมัติ วันยังไม่เปลี่ยน และ CEO ได้แจ้งเตือน", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    const t = getTask();
    expect(t.dueDate).toBe("2026-09-30T00:00:00.000Z");
    expect(t.dueDateRequests).toHaveLength(1);
    expect(t.dueDateRequests![0]).toMatchObject({ requestedBy: STAFF, newDate: "2026-10-07", status: "pending", reason: "รออะไหล่" });
    const toCeo = notificationsFor(CEO);
    expect(toCeo).toHaveLength(1);
    expect(toCeo[0]).toMatchObject({ kind: "task_due_request", taskId: "t1", link: "/report-task/tasks?task=t1" });
    expect(toCeo[0]!.message).toContain("ขอเลื่อนกำหนดส่ง");
    // คนขอไม่ได้แจ้งเตือนตัวเอง
    expect(notificationsFor(STAFF)).toHaveLength(0);
  });

  it("ขอซ้ำระหว่างรอ = แทนคำขอเดิม ไม่กองหลายใบ", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-10", "ลูกค้าเลื่อน");
    const pending = getTask().dueDateRequests!.filter((r) => r.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.newDate).toBe("2026-10-10");
  });

  it("อนุมัติ = วันเปลี่ยนจริง มีประวัติ และแจ้งผู้ขอ", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    const id = getTask().dueDateRequests![0]!.id;
    useTaskStore.getState().decideDueDateRequest("t1", id, CEO, true);
    const t = getTask();
    expect(new Date(t.dueDate).toISOString().slice(0, 10)).toBe(new Date("2026-10-07").toISOString().slice(0, 10));
    expect(t.revisions).toHaveLength(1);
    expect(t.dueDateRequests![0]).toMatchObject({ status: "approved", decidedBy: CEO });
    expect(notificationsFor(STAFF).some((n) => n.message.includes("อนุมัติให้เลื่อน"))).toBe(true);
  });

  it("ไม่อนุมัติ (มีเหตุผล) = วันเดิม และแจ้งผู้ขอพร้อมเหตุผล", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    const id = getTask().dueDateRequests![0]!.id;
    useTaskStore.getState().decideDueDateRequest("t1", id, CEO, false, "งานด่วน ลูกค้ารอ");
    const t = getTask();
    expect(t.dueDate).toBe("2026-09-30T00:00:00.000Z");
    expect(t.revisions).toHaveLength(0);
    expect(t.dueDateRequests![0]).toMatchObject({ status: "rejected", decisionNote: "งานด่วน ลูกค้ารอ" });
    const msg = notificationsFor(STAFF).find((n) => n.message.includes("ไม่อนุมัติ"))!.message;
    expect(msg).toContain("งานด่วน ลูกค้ารอ");
  });

  it("ไม่อนุมัติโดยไม่ใส่เหตุผลก็ได้", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    const id = getTask().dueDateRequests![0]!.id;
    useTaskStore.getState().decideDueDateRequest("t1", id, CEO, false, "   ");
    expect(getTask().dueDateRequests![0]!.status).toBe("rejected");
    expect(getTask().dueDateRequests![0]!.decisionNote).toBeUndefined();
  });

  it("ตัดสินแล้วกดซ้ำไม่มีผล (กันกดสองครั้ง)", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    const id = getTask().dueDateRequests![0]!.id;
    useTaskStore.getState().decideDueDateRequest("t1", id, CEO, false);
    useTaskStore.getState().decideDueDateRequest("t1", id, CEO, true);
    expect(getTask().dueDateRequests![0]!.status).toBe("rejected");
    expect(getTask().dueDate).toBe("2026-09-30T00:00:00.000Z");
  });

  it("งานกลุ่ม: อนุมัติแล้วเปลี่ยนเฉพาะวันของผู้ขอ", () => {
    useTaskStore.setState({ tasks: [task({ taskMode: "group", assigneeIds: [STAFF, BOSS] })] });
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    const id = getTask().dueDateRequests![0]!.id;
    useTaskStore.getState().decideDueDateRequest("t1", id, CEO, true);
    const t = getTask();
    expect(t.assigneeDueDates?.[STAFF]).toBe("2026-10-07");
    expect(t.assigneeDueDates?.[BOSS]).toBeUndefined();
    expect(t.dueDate).toBe("2026-09-30T00:00:00.000Z");
  });

  it("ผู้ขอยกเลิกคำขอได้ คนอื่นยกเลิกแทนไม่ได้", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-10-07", "รออะไหล่");
    const id = getTask().dueDateRequests![0]!.id;
    useTaskStore.getState().cancelDueDateRequest("t1", id, BOSS);
    expect(getTask().dueDateRequests![0]!.status).toBe("pending");
    useTaskStore.getState().cancelDueDateRequest("t1", id, STAFF);
    expect(getTask().dueDateRequests![0]!.status).toBe("cancelled");
  });
  it("ขอเลื่อนย้อนหลัง (ก่อน/เท่ากำหนดเดิม) ไม่ได้ — ไม่มีคำขอ ไม่แจ้งใคร", () => {
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-09-04", "พิมพ์ผิด");
    useTaskStore.getState().requestDueDateChange("t1", STAFF, "2026-09-30", "วันเดิม");
    expect(getTask().dueDateRequests ?? []).toHaveLength(0);
    expect(notificationsFor(CEO)).toHaveLength(0);
  });

  it("คำขอย้อนหลังที่ค้างอยู่ (ข้อมูลเก่า) อนุมัติไม่ได้ แต่ปฏิเสธได้", () => {
    const old = { id: "ddr-old", requestedBy: STAFF, requestedAt: "2026-09-30T01:00:00.000Z", newDate: "2026-09-04", previousDate: "2026-09-30T00:00:00.000Z", reason: "x", status: "pending" as const };
    useTaskStore.setState({ tasks: [task({ dueDateRequests: [old] })] });
    useTaskStore.getState().decideDueDateRequest("t1", "ddr-old", CEO, true);
    expect(getTask().dueDate).toBe("2026-09-30T00:00:00.000Z");
    expect(getTask().dueDateRequests![0]!.status).toBe("pending");
    useTaskStore.getState().decideDueDateRequest("t1", "ddr-old", CEO, false);
    expect(getTask().dueDateRequests![0]!.status).toBe("rejected");
  });
  it("หัวหน้าแก้กำหนดส่งตรง/รายคน/ทั้งหมด ย้อนไปก่อนวันเดิมไม่ได้", () => {
    useTaskStore.getState().reviseDueDate("t1", "2026-09-04T00:00:00.000Z", "พิมพ์ผิด", CEO, false);
    expect(getTask().dueDate).toBe("2026-09-30T00:00:00.000Z");
    expect(getTask().revisions).toHaveLength(0);
    useTaskStore.setState({ tasks: [task({ taskMode: "group", assigneeIds: [STAFF, BOSS] })] });
    useTaskStore.getState().reviseAssigneeDueDate("t1", STAFF, "2026-09-04", CEO, false);
    expect(getTask().assigneeDueDates?.[STAFF]).toBeUndefined();
    useTaskStore.setState({ tasks: [task({ taskMode: "group", assigneeIds: [STAFF, BOSS], assigneeDueDates: { [BOSS]: "2026-10-10" } })] });
    useTaskStore.getState().reviseAllAssigneeDueDates("t1", "2026-10-05", CEO, false);
    expect(getTask().assigneeDueDates?.[STAFF]).toBe("2026-10-05");
    expect(getTask().assigneeDueDates?.[BOSS]).toBe("2026-10-10");
  });
});
