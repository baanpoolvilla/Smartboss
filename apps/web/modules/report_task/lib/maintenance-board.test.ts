import { beforeEach, describe, expect, it } from "vitest";

import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import type { Task, User } from "@/modules/report_task/types";
import { matchesMaintenanceFilters, sortBoardEntries, type MaintenanceBoardItem } from "./maintenance-board";
import type { TaskFilterState } from "./task-filter";

const ALL: TaskFilterState = {
  assigneeId: "all",
  assignedById: "all",
  departmentId: "all",
  priority: "all",
  penalty: "all",
  preset: "all",
  customFrom: "",
  customTo: "",
  quickView: "all",
};

const people: User[] = [
  { id: "a", name: "ช่าง A", email: "a@x", avatar: "A", role: "ช่าง", departmentId: "d-tech" },
  { id: "b", name: "จัดซื้อ B", email: "b@x", avatar: "B", role: "จัดซื้อ", departmentId: "d-buy" },
];

function wo(over: Partial<MaintenanceBoardItem> = {}): MaintenanceBoardItem {
  return {
    kind: "wo",
    id: "w1",
    code: "WO-1",
    title: "ปั๊มเสีย",
    column: "todo",
    statusLabel: "รอดำเนินการ",
    priority: "medium",
    dueDate: "2099-10-20T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    overdue: false,
    responsibleId: "a",
    assigneeId: "a",
    involvedIds: ["a", "b"],
    place: "BS-HS1",
    href: "/maintenance/work-orders/w1",
    reactions: [],
    ...over,
  };
}

const task = (over: Partial<Task>) =>
  ({
    id: "t",
    status: "todo",
    priority: "medium",
    dueDate: "2099-10-25T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  }) as Task;

beforeEach(() => useEmployeeStore.setState({ employees: people }));

describe("ตัวกรองบอร์ด กับใบงานซ่อม/สั่งซื้อ", () => {
  // เปลี่ยน 20/10/2569: "งานของฉัน"/ผู้รับผิดชอบ = คนที่ได้รับมอบหมายใบนั้น (เดิม = ทุกคนที่เกี่ยว รวม CC/คนเปิดใบ)
  it("ผู้รับผิดชอบ = คนที่ได้รับมอบหมายใบ (ไม่ใช่ CC/คนเปิดใบ) · แผนก = แผนกของผู้รับผิดชอบ", () => {
    expect(matchesMaintenanceFilters(wo(), { ...ALL, assigneeId: "a" })).toBe(true);
    expect(matchesMaintenanceFilters(wo(), { ...ALL, assigneeId: "b" })).toBe(false);
    expect(matchesMaintenanceFilters(wo(), { ...ALL, assigneeId: "zz" })).toBe(false);
    expect(matchesMaintenanceFilters(wo(), { ...ALL, departmentId: "d-tech" })).toBe(true);
    expect(matchesMaintenanceFilters(wo(), { ...ALL, departmentId: "d-buy" })).toBe(false);
  });

  it("เลยกำหนดเท่านั้น / หักคะแนน / กำลังติดตาม", () => {
    expect(matchesMaintenanceFilters(wo({ overdue: true }), { ...ALL, penalty: "overdue" })).toBe(true);
    expect(matchesMaintenanceFilters(wo(), { ...ALL, penalty: "overdue" })).toBe(false);
    expect(matchesMaintenanceFilters(wo({ overdue: true }), { ...ALL, penalty: "docked" })).toBe(false);
  });

  // เปลี่ยน 20/10/2569: "ที่ฉันมอบหมาย" = ใบที่ฉันเปิด (เดิมใบงานซ่อมไม่ขึ้นเลย)
  it("ที่ฉันมอบหมาย = ใบที่คนนั้นเปิด", () => {
    expect(matchesMaintenanceFilters(wo({ createdById: "b" }), { ...ALL, assignedById: "b" })).toBe(true);
    expect(matchesMaintenanceFilters(wo({ createdById: "b" }), { ...ALL, assignedById: "a" })).toBe(false);
    expect(matchesMaintenanceFilters(wo(), { ...ALL, assignedById: "a" })).toBe(false);
  });

  it("ชิปสถานะด้านบนจับคอลัมน์ของใบ", () => {
    expect(matchesMaintenanceFilters(wo({ column: "review" }), { ...ALL, quickView: "review" })).toBe(true);
    expect(matchesMaintenanceFilters(wo({ column: "todo" }), { ...ALL, quickView: "done" })).toBe(false);
  });
});

describe("เรียงงานกับใบซ่อมปนกัน", () => {
  it("เลยกำหนดก่อน แล้ววันครบใกล้ก่อน แล้วความสำคัญสูงก่อน (วันเดียวกัน)", () => {
    const sorted = sortBoardEntries([
      { type: "task", task: task({ id: "t-low", priority: "low" }) },
      { type: "mx", item: wo({ id: "w-late", overdue: true }) },
      { type: "mx", item: wo({ id: "w-urgent", priority: "critical" }) },
      { type: "task", task: task({ id: "t-med" }) },
    ]);
    expect(sorted.map((e) => (e.type === "task" ? e.task.id : e.item.id))).toEqual(["w-late", "w-urgent", "t-med", "t-low"]);
  });

  // ผู้ใช้ขอ 20/10/2569 "ให้วันที่ที่จะครบมาแสดงก่อน" — วันครบใกล้ชนะความสำคัญ · ใบซ่อมไม่มีวันครบไปท้าย
  it("วันครบใกล้สุดขึ้นก่อน แม้ความสำคัญต่ำกว่า · ใบงานไม่ได้ตั้งวันครบไปท้าย", () => {
    const sorted = sortBoardEntries([
      { type: "mx", item: wo({ id: "w-nodue", priority: "critical", dueDate: null }) },
      { type: "task", task: task({ id: "t-later-critical", priority: "critical", dueDate: "2099-10-28T00:00:00.000Z" }) },
      { type: "mx", item: wo({ id: "w-soon-low", priority: "low", dueDate: "2099-10-21T00:00:00.000Z" }) },
      { type: "task", task: task({ id: "t-mid", dueDate: "2099-10-24T00:00:00.000Z" }) },
    ]);
    expect(sorted.map((e) => (e.type === "task" ? e.task.id : e.item.id))).toEqual(["w-soon-low", "t-mid", "t-later-critical", "w-nodue"]);
  });

  // ผู้ใช้ 27/11/2569 "การ์ดลงบิลก็นับตามวันใกล้ถึงละกันจะได้เหมือนกับของงาน" — ไม่ปักบนสุดแล้ว · วันเดียวกันการ์ดลงบิลขึ้นก่อน
  it("การ์ดรอบันทึกค่าใช้จ่ายเรียงตามวันครบรวมกับงาน · วันเดียวกันขึ้นก่อนงาน", () => {
    const sorted = sortBoardEntries([
      { type: "mx", item: wo({ id: "x-dec10", expensePending: true, dueDate: "2099-12-10T16:59:59.999Z" }) },
      { type: "task", task: task({ id: "t-tomorrow", dueDate: "2099-11-28T03:00:00.000Z" }) },
      { type: "task", task: task({ id: "t-dec10-morning", dueDate: "2099-12-10T02:00:00.000Z" }) },
      { type: "task", task: task({ id: "t-dec20", dueDate: "2099-12-20T03:00:00.000Z" }) },
    ]);
    expect(sorted.map((e) => (e.type === "task" ? e.task.id : e.item.id))).toEqual(["t-tomorrow", "x-dec10", "t-dec10-morning", "t-dec20"]);
  });
});

describe("applyRecorderView (Boss filters by the expense recorder, 27/11/2569)", async () => {
  const { applyRecorderView } = await import("./maintenance-board");
  const base = { kind: "wo", id: "w1", code: "WO-1", title: "t", column: "done", statusLabel: "ซ่อมเสร็จแล้ว", priority: "medium", dueDate: "2026-11-20T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z", overdue: false, responsibleId: "tech", assigneeId: "tech", createdById: "boss", involvedIds: [], place: null, href: "/x" } as unknown as MaintenanceBoardItem;
  const pending = { ...base, expenseTask: { recorderIds: ["rec"], dueDate: "2026-12-10T16:59:59.999Z", overdue: false } } as MaintenanceBoardItem;
  it("unfiltered or other person = card unchanged", () => {
    expect(applyRecorderView(pending, { ...ALL })).toBe(pending);
    expect(applyRecorderView(pending, { ...ALL, assigneeId: "tech" })).toBe(pending);
  });
  it("filter = recorder → todo with expense deadline, matches the filter", () => {
    const v = applyRecorderView(pending, { ...ALL, assigneeId: "rec" });
    expect(v.column).toBe("todo");
    expect(v.dueDate).toBe("2026-12-10T16:59:59.999Z");
    expect(v.expensePending).toBe(true);
    expect(matchesMaintenanceFilters(v, { ...ALL, assigneeId: "rec" })).toBe(true);
  });
  it("hidden extra row shows only under the recorder filter", () => {
    const extra = { ...pending, expenseTaskOnly: true } as MaintenanceBoardItem;
    expect(matchesMaintenanceFilters(applyRecorderView(extra, { ...ALL }), { ...ALL })).toBe(false);
    expect(matchesMaintenanceFilters(applyRecorderView(extra, { ...ALL, assigneeId: "tech" }), { ...ALL, assigneeId: "tech" })).toBe(false);
    expect(matchesMaintenanceFilters(applyRecorderView(extra, { ...ALL, assigneeId: "rec" }), { ...ALL, assigneeId: "rec" })).toBe(true);
  });
});
