import { departments, getUser, users } from "@/modules/report_task/data/mock";
import { isLate } from "@/modules/report_task/lib/reports";
import { priorityMeta, taskPriorityOrder } from "@/modules/report_task/lib/task-meta";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import type { Task } from "@/modules/report_task/types";

/**
 * Planner's Charts colour tasks by *progress*, where "Late" replaces the task's
 * status rather than sitting beside it — so every task falls in exactly one
 * segment and the stacked bars add up to the task count.
 */
export type ProgressSegment = "notStarted" | "inProgress" | "late" | "completed";

/**
 * On-brand status palette: green leads (เสร็จสิ้น), a neutral slate carries the
 * "not started / inactive" segment so the ring reads green-forward rather than
 * rainbow, and red (ล่าช้า) and green are kept non-adjacent in the ring order so
 * red-green colourblind viewers can still tell the two key segments apart.
 * Every segment is also directly labelled, so identity is never colour-alone.
 */
export const segmentOrder: ProgressSegment[] = ["notStarted", "late", "inProgress", "completed"];

export const segmentMeta: Record<ProgressSegment, { label: string; color: string }> = {
  notStarted: { label: "รอดำเนินการ", color: "#94a3b8" },
  late: { label: "ล่าช้า", color: chartColors.red },
  inProgress: { label: "กำลังทำ", color: chartColors.blue },
  completed: { label: "เสร็จสิ้น", color: chartColors.green },
};

export function segmentOf(task: Task): ProgressSegment {
  if (task.status === "done") return "completed";
  if (isLate(task)) return "late";
  if (task.status === "in_progress") return "inProgress";
  return "notStarted";
}

export interface StackedRow extends Record<ProgressSegment, number> {
  id: string;
  name: string;
  total: number;
}

function emptyRow(id: string, name: string): StackedRow {
  return { id, name, notStarted: 0, inProgress: 0, late: 0, completed: 0, total: 0 };
}

function tally(row: StackedRow, task: Task) {
  row[segmentOf(task)] += 1;
  row.total += 1;
}

/** Status donut — counts per segment, plus how many tasks are still open. */
export function buildStatusDonut(tasks: Task[]) {
  const counts = { notStarted: 0, inProgress: 0, late: 0, completed: 0 };
  for (const t of tasks) counts[segmentOf(t)] += 1;
  const data = segmentOrder
    .map((s) => ({ segment: s, label: segmentMeta[s].label, color: segmentMeta[s].color, value: counts[s] }))
    .filter((d) => d.value > 0);
  return { data, tasksLeft: tasks.length - counts.completed, total: tasks.length };
}

/** Progress of tasks by priority. */
export function buildPriorityChart(tasks: Task[]): StackedRow[] {
  return taskPriorityOrder.map((p) => {
    const row = emptyRow(p, priorityMeta[p].label);
    for (const t of tasks) if (t.priority === p) tally(row, t);
    return row;
  });
}

/** Progress of tasks per department (Planner's "Bucket" equivalent). */
export function buildDepartmentChart(tasks: Task[]): StackedRow[] {
  return departments
    .map((d) => {
      const row = emptyRow(d.id, d.name);
      for (const t of tasks) if (t.departmentIds.includes(d.id)) tally(row, t);
      return row;
    })
    .filter((r) => r.total > 0);
}

/** Tasks assigned to each person, coloured by progress. */
export function buildMemberChart(tasks: Task[]): StackedRow[] {
  return users
    .map((u) => {
      const row = emptyRow(u.id, getUser(u.id)?.name.split(" ")[0] ?? u.name);
      for (const t of tasks) if (t.assigneeIds.includes(u.id)) tally(row, t);
      return row;
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}
