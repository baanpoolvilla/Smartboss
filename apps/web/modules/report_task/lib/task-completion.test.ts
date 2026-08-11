import { describe, expect, it } from "vitest";
import { deriveCompletedAssigneeIds } from "@/modules/report_task/lib/task-completion";
import type { ChecklistItem } from "@/modules/report_task/types";

function item(ownerId: string, done: boolean): ChecklistItem {
  return { id: `${ownerId}-${done}`, text: "x", done, ownerId };
}

describe("deriveCompletedAssigneeIds", () => {
  it("returns an assignee only once every item they own is done", () => {
    const checklist = [item("usr-01", true), item("usr-01", false), item("usr-02", true)];
    expect(deriveCompletedAssigneeIds(["usr-01", "usr-02"], checklist)).toEqual(["usr-02"]);
  });

  it("collapses to plain checklist-complete for a single assignee (individual task)", () => {
    const checklist = [item("usr-01", true), item("usr-01", true)];
    expect(deriveCompletedAssigneeIds(["usr-01"], checklist)).toEqual(["usr-01"]);
  });

  it("never counts an assignee with zero owned items as done", () => {
    expect(deriveCompletedAssigneeIds(["usr-01"], [])).toEqual([]);
  });
});
