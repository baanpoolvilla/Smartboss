import { describe, expect, it } from "vitest";
import { dueUrgency, effectiveDueDate } from "@/modules/report_task/lib/task-flags";
import type { Task } from "@/modules/report_task/types";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const base = {
  taskMode: "group",
  status: "in_progress",
  assigneeIds: ["a", "b"],
  dueDate: daysFromNow(-3),
} as unknown as Task;

describe("effectiveDueDate", () => {
  it("uses per-person extensions — everyone extended means not overdue", () => {
    const t = { ...base, assigneeDueDates: { a: daysFromNow(4), b: daysFromNow(4) } } as Task;
    expect(effectiveDueDate(t)).toBe(t.assigneeDueDates!.a);
    expect(dueUrgency(t)).not.toBe("overdue");
  });

  it("is overdue while someone still pending has a passed date", () => {
    const t = { ...base, assigneeDueDates: { a: daysFromNow(4) } } as Task;
    expect(dueUrgency(t)).toBe("overdue");
  });

  it("ignores people who already finished", () => {
    const t = { ...base, assigneeDueDates: { a: daysFromNow(4) }, completedAssigneeIds: ["b"] } as Task;
    expect(dueUrgency(t)).not.toBe("overdue");
  });

  it("individual tasks keep their own due date", () => {
    const t = { ...base, taskMode: "individual", assigneeDueDates: { a: daysFromNow(4) } } as Task;
    expect(effectiveDueDate(t)).toBe(t.dueDate);
  });
});
