import type { Task } from "@/modules/report_task/types";

/**
 * Backfills fields added by the individual/group-task feature onto tasks
 * persisted before it existed. Runs on every read (see tasks-repo.ts) rather
 * than as a one-time pass — cheap no-op for anything already migrated, same
 * pattern as migrateIssueStoreSlice in issue-migration.ts.
 */
export function migrateTask(t: Task): Task {
  const taskMode = t.taskMode ?? (t.assigneeIds.length > 1 ? "group" : "individual");
  const firstAssignee = t.assigneeIds[0];
  let checklistChanged = false;
  const checklist = t.checklist.map((c) => {
    if (c.ownerId) return c;
    checklistChanged = true;
    return { ...c, ownerId: firstAssignee };
  });
  if (taskMode === t.taskMode && !checklistChanged) return t;
  return { ...t, taskMode, checklist };
}

export function migrateTasks(tasks: Task[]): Task[] {
  return tasks.map(migrateTask);
}
