"use client";

import { useMemo } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";

/**
 * All tasks in the store, narrowed to whatever the current viewer is allowed
 * to see (canSeeTask) — a department head only ever gets their own
 * department here, never the whole company (that's owner-only). Shared base
 * for every dashboard widget so none of them can accidentally read past the
 * viewer's scope by pulling straight from the task store.
 */
export function useVisibleTasks() {
  const tasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  return useMemo(() => tasks.filter((t) => canSeeTask(t, viewingAsUserId)), [tasks, viewingAsUserId]);
}
