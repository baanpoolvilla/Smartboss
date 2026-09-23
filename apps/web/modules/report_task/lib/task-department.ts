import type { Task, ProjectTopic } from "@/modules/report_task/types";

/**
 * Which department(s) count as "this task's department" for the board's
 * department grouping/drilldown (kanban-board.tsx's groupBy="department",
 * DepartmentTopicsBoard) — NOT for permissions/visibility, which stay on
 * `task.departmentIds` (derived from who's actually assigned) untouched.
 *
 * A project can span several departments' worth of assignees (someone
 * borrowed in from another team to help) — grouping by each assignee's own
 * home department scattered that project's tasks across every department
 * anyone on it happens to belong to, instead of the one department the
 * project actually belongs to ("มันจับแค่ของเราตามแผนกเราถูกไหม" — a
 * cross-department assignee's own tasks shouldn't leak into a foreign
 * project's home department, and vice versa). Once a project's topic has a
 * `departmentId` set (tagged once at creation — see new-task-dialog.tsx's
 * confirmCreateProjectTopic), every task under it is grouped by THAT
 * department alone, regardless of which department(s) its assignees are
 * actually in. A task with no topic, or an older topic made before this
 * field existed (`departmentId` unset), falls back to its own
 * `departmentIds` exactly as before.
 */
export function taskDepartmentIdsForBoard(task: Task, topics: ProjectTopic[]): string[] {
  const topic = task.projectTopicId ? topics.find((t) => t.id === task.projectTopicId) : undefined;
  if (topic?.departmentId) return [topic.departmentId];
  return task.departmentIds;
}
