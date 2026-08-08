"use client";

import { useMemo } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { matchesTaskFilters } from "@/modules/report_task/lib/task-filter";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { useTaskSheetParam } from "@/modules/report_task/hooks/use-task-sheet-param";
import { TaskGrid } from "./task-grid";
import { TaskDetailSheet } from "./task-detail-sheet";

/**
 * Self-contained Grid view — same filtered dataset as the Kanban board (no
 * re-entry, no separate data source), just rendered as a sortable table.
 */
export function TaskGridView() {
  const storeTasks = useTaskStore((s) => s.tasks);
  const filters = useTaskStore((s) => s.filters);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const { openTaskId, open: setOpenTaskId, close: closeTaskSheet } = useTaskSheetParam();

  const filtered = useMemo(
    () => storeTasks.filter((t) => canSeeTask(t, viewingAsUserId) && matchesTaskFilters(t, filters)),
    [storeTasks, viewingAsUserId, filters]
  );

  return (
    <>
      <TaskGrid tasks={filtered} onOpen={setOpenTaskId} />
      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && closeTaskSheet()} />
    </>
  );
}
