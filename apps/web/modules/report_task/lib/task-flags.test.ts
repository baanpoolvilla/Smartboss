import { describe, expect, it } from "vitest";
import { dueUrgency, isSuspiciousRevision, reopenCount, reactionCounts } from "@/modules/report_task/lib/task-flags";
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
    assigneeIds: [],
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

describe("dueUrgency", () => {
  it("is normal for a done task even if overdue", () => {
    expect(dueUrgency(makeTask({ status: "done", dueDate: daysFromNow(-5) }))).toBe("normal");
  });

  it("is overdue when the due date already passed", () => {
    expect(dueUrgency(makeTask({ dueDate: daysFromNow(-1) }))).toBe("overdue");
  });

  it("is soon within the next 2 days", () => {
    expect(dueUrgency(makeTask({ dueDate: daysFromNow(2) }))).toBe("soon");
  });

  it("is normal further than 2 days out", () => {
    expect(dueUrgency(makeTask({ dueDate: daysFromNow(5) }))).toBe("normal");
  });
});

describe("isSuspiciousRevision", () => {
  it("flags 2 or more revisions", () => {
    const revision = { revisionNumber: 1, previousDate: "", newDate: "", reason: "", revisedBy: "", revisedAt: "" };
    expect(isSuspiciousRevision(makeTask({ revisions: [revision, revision] }))).toBe(true);
  });

  it("does not flag a single revision", () => {
    const revision = { revisionNumber: 1, previousDate: "", newDate: "", reason: "", revisedBy: "", revisedAt: "" };
    expect(isSuspiciousRevision(makeTask({ revisions: [revision] }))).toBe(false);
  });
});

describe("reopenCount", () => {
  it("counts only revisions tagged as a reopen", () => {
    const reopen = { revisionNumber: 1, previousDate: "", newDate: "", reason: "[เปิดงานใหม่] พลาด", revisedBy: "", revisedAt: "" };
    const normal = { revisionNumber: 2, previousDate: "", newDate: "", reason: "เลื่อนกำหนด", revisedBy: "", revisedAt: "" };
    expect(reopenCount(makeTask({ revisions: [reopen, normal, reopen] }))).toBe(2);
  });
});

describe("reactionCounts", () => {
  it("tallies reactions by stickerId", () => {
    const reactions = [
      { id: "r1", stickerId: "fire", byUserId: "usr-01", createdAt: "" },
      { id: "r2", stickerId: "fire", byUserId: "usr-02", createdAt: "" },
      { id: "r3", stickerId: "angry", byUserId: "usr-03", createdAt: "" },
    ];
    expect(reactionCounts(makeTask({ reactions }))).toEqual({ fire: 2, angry: 1 });
  });

  it("returns an empty object for no reactions", () => {
    expect(reactionCounts(makeTask())).toEqual({});
  });
});
