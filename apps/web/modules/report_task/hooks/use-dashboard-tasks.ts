"use client";

import { useMemo } from "react";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { filterTasksByDashboard } from "@/modules/report_task/lib/date-filter";

/**
 * Dashboard-scoped tasks: same visibility rule as everywhere else
 * (canSeeTask, via useVisibleTasks) applied first — a department head's
 * dashboard only ever covers their own department, never the whole company
 * (that's owner-only, see isOwner) — then the personId/date pickers narrow
 * further within that.
 */
export function useDashboardTasks() {
  const visible = useVisibleTasks();
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const priority = useDashboardFilterStore((s) => s.priority);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);

  return useMemo(
    () => filterTasksByDashboard(visible, { personId, departmentId, priority, preset, customFrom, customTo }),
    [visible, personId, departmentId, priority, preset, customFrom, customTo]
  );
}
