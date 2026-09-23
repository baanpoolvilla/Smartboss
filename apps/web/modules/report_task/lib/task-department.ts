import type { Task, ProjectTopic } from "@/modules/report_task/types";

/** Sentinel id for the top-level "อื่นๆ" bucket — a real Department.id never
 * looks like this, so it can share the same columns array/URL param
 * (`?dept=`) as every real department without colliding. */
export const OTHER_DEPARTMENT_ID = "__other__";

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
 * actually in.
 *
 * A task with NO project topic at all never had a deliberate department
 * choice made for it — it doesn't confidently belong to any real department,
 * so it returns `[]` here and lands in the top-level "อื่นๆ" bucket instead
 * (see kanban-board.tsx's columns, OTHER_DEPARTMENT_ID) rather than being
 * guessed into whichever department its assignees happen to be in ("จะเลือก
 * ตอนสร้างว่างานนี้อยู่ในแผนกนี้และโปรเจคชื่ออะไร" — department is meant to
 * be a deliberate pick via a project, not an assignee-derived guess). A task
 * that DOES have a topic, but one made before ProjectTopic.departmentId
 * existed (still unset), falls back to its own `departmentIds` — the old
 * behavior — since at least a real project exists there to eventually tag.
 */
export function taskDepartmentIdsForBoard(task: Task, topics: ProjectTopic[]): string[] {
  if (!task.projectTopicId) return [];
  const topic = topics.find((t) => t.id === task.projectTopicId);
  if (topic?.departmentId) return [topic.departmentId];
  return task.departmentIds;
}
