import { departments, tasks, users } from "@/modules/report_task/data/mock";
import { defaultStickers } from "@/modules/report_task/data/stickers";
import { daysUntil } from "@/modules/report_task/lib/format";
import type { DepartmentReport, ScoreBreakdown, Sticker, Task, UserReport } from "@/modules/report_task/types";

export function isLate(task: Task) {
  if (task.status === "done") return false;
  // daysUntil compares the due date's UTC calendar day against the viewer's
  // actual local "today" (see format.ts) — a raw `due < nowMs()` epoch
  // comparison instead flagged tasks due "today" as late from ~7am onward
  // (once the UTC-midnight due timestamp had passed in the local timezone),
  // hours before the day was actually over, and disagreed with dueUrgency()
  // in task-flags.ts which already did this correctly.
  return daysUntil(task.dueDate) < 0;
}

export function completionHours(task: Task) {
  const start = new Date(task.startDate).getTime();
  const end = new Date(task.updatedAt).getTime();
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60)));
}

function stickerPoints(taskList: Task[], stickers: Sticker[]) {
  const byId = new Map(stickers.map((s) => [s.id, s.points]));
  let sum = 0;
  for (const t of taskList) {
    for (const r of t.reactions) {
      sum += byId.get(r.stickerId) ?? 0;
    }
  }
  return sum;
}

/** Total of the discretionary missed-deadline docks a lead applied to these tasks. */
export function manualPenaltyPoints(taskList: Task[]) {
  return taskList.reduce((sum, t) => sum + (t.penalty?.points ?? 0), 0);
}

function scoreFor(
  assigned: number,
  completed: number,
  late: number,
  revisions: number,
  stickerAdjustment: number,
  manualPenalty: number
): ScoreBreakdown {
  if (assigned === 0) {
    return { base: 0, latePenalty: 0, revisionPenalty: 0, manualPenalty: 0, stickerAdjustment: 0, total: 0 };
  }
  const base = Math.round((completed / assigned) * 100);
  const latePenalty = late * 4;
  const revisionPenalty = revisions * 2;
  const total = Math.max(
    0,
    Math.min(100, base - latePenalty - revisionPenalty - manualPenalty + stickerAdjustment)
  );
  return { base, latePenalty, revisionPenalty, manualPenalty, stickerAdjustment, total };
}

/** The metrics shared by a per-user and a per-department report row. */
function reportMetricsFor(scopedTasks: Task[], stickers: Sticker[]) {
  const completed = scopedTasks.filter((t) => t.status === "done");
  const late = scopedTasks.filter(isLate);
  const revisionCount = scopedTasks.reduce((sum, t) => sum + t.revisions.length, 0);
  const completionRate = scopedTasks.length ? Math.round((completed.length / scopedTasks.length) * 100) : 0;
  const avgCompletionTime = completed.length
    ? Math.round(completed.reduce((s, t) => s + completionHours(t), 0) / completed.length)
    : 0;
  const breakdown = scoreFor(
    scopedTasks.length,
    completed.length,
    late.length,
    revisionCount,
    stickerPoints(scopedTasks, stickers),
    manualPenaltyPoints(scopedTasks)
  );
  return {
    assignedTasks: scopedTasks.length,
    completedTasks: completed.length,
    lateTasks: late.length,
    completionRate,
    score: breakdown.total,
    scoreBreakdown: breakdown,
    avgCompletionTime,
    revisionCount,
  };
}

export function buildUserReports(taskList: Task[] = tasks, stickers: Sticker[] = defaultStickers): UserReport[] {
  return users.map((u) => ({
    userId: u.id,
    ...reportMetricsFor(
      taskList.filter((t) => t.assigneeIds.includes(u.id)),
      stickers
    ),
  }));
}

export function buildDepartmentReports(taskList: Task[] = tasks, stickers: Sticker[] = defaultStickers): DepartmentReport[] {
  return departments.map((d) => ({
    departmentId: d.id,
    ...reportMetricsFor(
      taskList.filter((t) => t.departmentIds.includes(d.id)),
      stickers
    ),
  }));
}

export function statusCounts(taskList: Task[] = tasks) {
  const counts = { todo: 0, in_progress: 0, done: 0 };
  for (const t of taskList) counts[t.status]++;
  return counts;
}

export function priorityCounts(taskList: Task[] = tasks) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of taskList) counts[t.priority]++;
  return counts;
}

export function overallDetailedKpis(taskList: Task[] = tasks, stickers: Sticker[] = defaultStickers) {
  const total = taskList.length;
  const completed = taskList.filter((t) => t.status === "done");
  const late = taskList.filter(isLate);
  const revisionCount = taskList.reduce((sum, t) => sum + t.revisions.length, 0);
  const avgCompletionTime = completed.length
    ? Math.round(completed.reduce((s, t) => s + completionHours(t), 0) / completed.length)
    : 0;
  return {
    completionRate: total ? Math.round((completed.length / total) * 100) : 0,
    latePercent: total ? Math.round((late.length / total) * 100) : 0,
    avgCompletionTime,
    revisionCount,
    stickerAdjustment: stickerPoints(taskList, stickers),
  };
}

export function overallKpis(taskList: Task[] = tasks) {
  const total = taskList.length;
  const completed = taskList.filter((t) => t.status === "done").length;
  const late = taskList.filter(isLate).length;
  const inProgress = taskList.filter((t) => t.status === "in_progress").length;
  return {
    total,
    completed,
    late,
    inProgress,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
  };
}

export function overdueTasks(taskList: Task[] = tasks) {
  return taskList.filter(isLate).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}
