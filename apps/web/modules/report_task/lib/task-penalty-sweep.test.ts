import { describe, expect, it } from "vitest";
import { sweepAutoPenalties, LATE_PENALTY_POINTS, SYSTEM_USER_ID } from "@/modules/report_task/lib/task-penalty-sweep";
import type { Task } from "@/modules/report_task/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: "t1",
    title: "Test task",
    description: "",
    status: "todo",
    priority: "medium",
    assigneeIds: ["usr-02"],
    assignedById: "usr-01",
    departmentIds: ["dep-eng"],
    startDate: now,
    dueDate: now,
    originalDueDate: now,
    attachments: [],
    comments: [],
    revisions: [],
    reactions: [],
    checklist: [],
    showChecklistOnCard: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

describe("sweepAutoPenalties", () => {
  it("is a no-op for a task that isn't overdue", () => {
    const result = sweepAutoPenalties([makeTask({ originalDueDate: daysFromNow(5) })]);
    expect(result.changed).toBe(false);
    expect(result.tasks[0]!.missedDeadlineOnce).toBeFalsy();
  });

  it("flags missedDeadlineOnce for an overdue flexible task without docking", () => {
    const result = sweepAutoPenalties([
      makeTask({ originalDueDate: daysFromNow(-1), deadlineType: "flexible" }),
    ]);
    expect(result.changed).toBe(true);
    expect(result.tasks[0]!.missedDeadlineOnce).toBe(true);
    expect(result.tasks[0]!.penalty).toBeUndefined();
    expect(result.logs).toHaveLength(0);
  });

  it("docks a strict overdue task automatically and logs/notifies once", () => {
    const result = sweepAutoPenalties([
      makeTask({ originalDueDate: daysFromNow(-1), deadlineType: "strict" }),
    ]);
    expect(result.changed).toBe(true);
    expect(result.tasks[0]!.penalty?.points).toBe(LATE_PENALTY_POINTS);
    expect(result.tasks[0]!.penalty?.byUserId).toBe(SYSTEM_USER_ID);
    expect(result.logs).toHaveLength(1);
    expect(result.notifications).toHaveLength(1);
  });

  it("is idempotent — a second sweep over already-flagged tasks changes nothing", () => {
    const first = sweepAutoPenalties([makeTask({ originalDueDate: daysFromNow(-1), deadlineType: "strict" })]);
    const second = sweepAutoPenalties(first.tasks);
    expect(second.changed).toBe(false);
    expect(second.logs).toHaveLength(0);
  });

  it("flags a done task that finished after its original due date", () => {
    const result = sweepAutoPenalties([
      makeTask({
        status: "done",
        originalDueDate: daysFromNow(-5),
        completedAt: daysFromNow(-1),
      }),
    ]);
    expect(result.changed).toBe(true);
    expect(result.tasks[0]!.missedDeadlineOnce).toBe(true);
  });

  it("does not flag a done task that finished on time", () => {
    const result = sweepAutoPenalties([
      makeTask({
        status: "done",
        originalDueDate: daysFromNow(5),
        completedAt: daysFromNow(-1),
      }),
    ]);
    expect(result.changed).toBe(false);
  });

  it("never re-docks a task that already has a penalty", () => {
    const result = sweepAutoPenalties([
      makeTask({
        originalDueDate: daysFromNow(-1),
        deadlineType: "strict",
        missedDeadlineOnce: true,
        penalty: { points: 3, byUserId: "usr-01", appliedAt: new Date().toISOString() },
      }),
    ]);
    expect(result.changed).toBe(false);
    expect(result.logs).toHaveLength(0);
  });
});
