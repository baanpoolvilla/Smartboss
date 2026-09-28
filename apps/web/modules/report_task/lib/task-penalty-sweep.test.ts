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
    taskMode: "individual",
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

  it("docks an overdue task automatically and logs/notifies once", () => {
    const result = sweepAutoPenalties([
      makeTask({ originalDueDate: daysFromNow(-1) }),
    ]);
    expect(result.changed).toBe(true);
    expect(result.tasks[0]!.missedDeadlineOnce).toBe(true);
    expect(result.tasks[0]!.penalty?.points).toBe(LATE_PENALTY_POINTS);
    expect(result.tasks[0]!.penalty?.byUserId).toBe(SYSTEM_USER_ID);
    expect(result.logs).toHaveLength(1);
    expect(result.notifications).toHaveLength(1);
  });

  it("is idempotent — a second sweep over already-flagged tasks changes nothing", () => {
    const first = sweepAutoPenalties([makeTask({ originalDueDate: daysFromNow(-1) })]);
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
        missedDeadlineOnce: true,
        penalty: { points: 3, byUserId: "usr-01", appliedAt: new Date().toISOString() },
      }),
    ]);
    expect(result.changed).toBe(false);
    expect(result.logs).toHaveLength(0);
  });

  describe("due-date extensions", () => {
    const ext = (revisedAtDays: number, from: number, to: number) => ({
      revisionNumber: 1,
      previousDate: daysFromNow(from),
      newDate: daysFromNow(to),
      reason: ".",
      revisedBy: "usr-01",
      revisedAt: daysFromNow(revisedAtDays),
    });

    it("does not dock a task extended before its original deadline passed", () => {
      const result = sweepAutoPenalties([
        makeTask({ originalDueDate: daysFromNow(-3), dueDate: daysFromNow(4), revisions: [ext(-3, -3, 4)] }),
      ]);
      expect(result.changed).toBe(false);
      expect(result.tasks[0]!.penalty).toBeFalsy();
    });

    it("still docks a task extended only after it was already late", () => {
      const result = sweepAutoPenalties([
        makeTask({ originalDueDate: daysFromNow(-3), dueDate: daysFromNow(4), revisions: [ext(-1, -3, 4)] }),
      ]);
      expect(result.tasks[0]!.penalty?.byUserId).toBe(SYSTEM_USER_ID);
    });

    it("takes back an automatic dock that an in-time extension made wrong", () => {
      const result = sweepAutoPenalties([
        makeTask({
          originalDueDate: daysFromNow(-3),
          dueDate: daysFromNow(4),
          revisions: [ext(-3, -3, 4)],
          missedDeadlineOnce: true,
          penalty: { points: 3, byUserId: SYSTEM_USER_ID, appliedAt: daysFromNow(-2) },
        }),
      ]);
      expect(result.changed).toBe(true);
      expect(result.tasks[0]!.penalty).toBeNull();
      expect(result.tasks[0]!.missedDeadlineOnce).toBe(false);
      expect(result.revokedRefIds).toEqual(["t1"]);
    });

    it("leaves a manual dock alone", () => {
      const result = sweepAutoPenalties([
        makeTask({
          originalDueDate: daysFromNow(-3),
          revisions: [ext(-3, -3, 4)],
          missedDeadlineOnce: true,
          penalty: { points: 3, byUserId: "usr-01", appliedAt: daysFromNow(-2) },
        }),
      ]);
      expect(result.changed).toBe(false);
    });
  });

  describe("group tasks", () => {
    it("only docks the assignee whose own effective due date passed", () => {
      const result = sweepAutoPenalties([
        makeTask({
          taskMode: "group",
          assigneeIds: ["usr-02", "usr-03"],
          originalDueDate: daysFromNow(5),
          assigneeDueDates: { "usr-02": daysFromNow(-1) },
        }),
      ]);
      const t = result.tasks[0]!;
      expect(t.penalties?.["usr-02"]?.points).toBe(LATE_PENALTY_POINTS);
      expect(t.penalties?.["usr-03"]).toBeUndefined();
      expect(result.logs).toHaveLength(1);
      expect(result.notifications).toHaveLength(1);
    });

    it("never docks an assignee who already completed their part", () => {
      const result = sweepAutoPenalties([
        makeTask({
          taskMode: "group",
          assigneeIds: ["usr-02", "usr-03"],
          originalDueDate: daysFromNow(-1),
          completedAssigneeIds: ["usr-02"],
        }),
      ]);
      const t = result.tasks[0]!;
      expect(t.penalties?.["usr-02"]).toBeUndefined();
      expect(t.penalties?.["usr-03"]?.points).toBe(LATE_PENALTY_POINTS);
    });

    it("is idempotent per assignee", () => {
      const first = sweepAutoPenalties([
        makeTask({ taskMode: "group", assigneeIds: ["usr-02", "usr-03"], originalDueDate: daysFromNow(-1) }),
      ]);
      const second = sweepAutoPenalties(first.tasks);
      expect(second.changed).toBe(false);
      expect(second.logs).toHaveLength(0);
    });
  });
});
