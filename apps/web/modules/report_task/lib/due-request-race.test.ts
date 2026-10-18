import { describe, expect, it } from "vitest";
import { resolveDueRequestRaces } from "@/modules/report_task/lib/due-request-race";
import { mergeThreeWay } from "@/modules/report_task/components/shared/store-merge";
import type { DueDateRequest, Task } from "@/modules/report_task/types";

const req = (patch: Partial<DueDateRequest> = {}): DueDateRequest => ({
  id: "r1",
  requestedBy: "u-staff",
  requestedAt: "2026-10-15T03:00:00.000Z",
  newDate: "2026-10-25",
  previousDate: "2026-10-16T00:00:00.000Z",
  reason: "รออะไหล่",
  status: "pending",
  ...patch,
});

const task = (patch: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    title: "งานทดสอบ",
    dueDate: "2026-10-16T00:00:00.000Z",
    revisions: [],
    dueDateRequests: [req()],
    ...patch,
  }) as Task;

describe("resolveDueRequestRaces", () => {
  it("first decision wins: their approval stays, my later rejection (and nothing else of mine on that task) is dropped", () => {
    const base = [task()];
    const theirs = [task({ dueDate: "2026-10-25T00:00:00.000Z", dueDateRequests: [req({ status: "approved", decidedBy: "u-ceo" })] })];
    const mine = [task({ dueDateRequests: [req({ status: "rejected", decidedBy: "u-head" })] })];
    const merged = mergeThreeWay(base, mine, theirs) as Task[];
    const { tasks, lost } = resolveDueRequestRaces(base, mine, theirs, merged);
    expect(tasks[0]!.dueDateRequests![0]!.status).toBe("approved");
    expect(tasks[0]!.dueDate).toBe("2026-10-25T00:00:00.000Z");
    expect(lost).toHaveLength(1);
    expect(lost[0]!.winner.decidedBy).toBe("u-ceo");
    expect(lost[0]!.mine).toBe("rejected");
  });

  it("their rejection wins over my later approval — my date move is dropped too", () => {
    const base = [task()];
    const theirs = [task({ dueDateRequests: [req({ status: "rejected", decidedBy: "u-ceo" })] })];
    const mine = [task({ dueDate: "2026-10-25T00:00:00.000Z", dueDateRequests: [req({ status: "approved", decidedBy: "u-head" })] })];
    const merged = mergeThreeWay(base, mine, theirs) as Task[];
    const { tasks, lost } = resolveDueRequestRaces(base, mine, theirs, merged);
    expect(tasks[0]!.dueDateRequests![0]!.status).toBe("rejected");
    expect(tasks[0]!.dueDate).toBe("2026-10-16T00:00:00.000Z");
    expect(lost).toHaveLength(1);
  });

  it("no race when only I decided — merge result untouched", () => {
    const base = [task()];
    const theirs = [task({ title: "เปลี่ยนชื่อ" })];
    const mine = [task({ dueDateRequests: [req({ status: "approved", decidedBy: "u-head" })] })];
    const merged = mergeThreeWay(base, mine, theirs) as Task[];
    const { tasks, lost } = resolveDueRequestRaces(base, mine, theirs, merged);
    expect(tasks).toBe(merged);
    expect(tasks[0]!.dueDateRequests![0]!.status).toBe("approved");
    expect(tasks[0]!.title).toBe("เปลี่ยนชื่อ");
    expect(lost).toHaveLength(0);
  });

  it("other tasks keep the normal merge", () => {
    const base = [task(), task({ id: "t2", dueDateRequests: [] })];
    const theirs = [task({ dueDateRequests: [req({ status: "approved", decidedBy: "u-ceo" })] }), task({ id: "t2", dueDateRequests: [] })];
    const mine = [task({ dueDateRequests: [req({ status: "rejected", decidedBy: "u-head" })] }), task({ id: "t2", title: "ของฉัน", dueDateRequests: [] })];
    const merged = mergeThreeWay(base, mine, theirs) as Task[];
    const { tasks } = resolveDueRequestRaces(base, mine, theirs, merged);
    expect(tasks.find((t) => t.id === "t2")!.title).toBe("ของฉัน");
  });
});
