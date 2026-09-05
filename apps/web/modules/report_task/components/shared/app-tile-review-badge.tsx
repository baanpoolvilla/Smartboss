"use client";

import { useEffect, useState } from "react";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { canReviewTask } from "@/modules/report_task/lib/permissions";
import type { Task } from "@/modules/report_task/types";
import type { User, Department } from "@/modules/report_task/types";

/**
 * Same "งานรอตรวจ" count/visibility rule as TaskReviewNavBadge (see that
 * file), rendered on the home app-launcher tile instead of the in-module
 * rail. This sits outside the report_task module, so none of its sync
 * components (TaskSync/StoreHydrator) are mounted here — fetches
 * employees/departments/tasks and rehydrates identity itself rather than
 * assuming the stores are already populated.
 */
export function AppTileReviewBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    useIdentityStore.persist.rehydrate();

    async function load() {
      try {
        const [tasksRes, employeesRes, departmentsRes] = await Promise.all([
          fetch("/api/report-task/tasks"),
          fetch("/api/report-task/store/employees"),
          fetch("/api/report-task/store/departments"),
        ]);
        const [tasks, employees, departments] = (await Promise.all([
          tasksRes.json(),
          employeesRes.json(),
          departmentsRes.json(),
        ])) as [Task[], User[], Department[]];
        if (cancelled) return;

        useEmployeeStore.getState().setEmployees(employees);
        useDepartmentStore.getState().setDepartments(departments);
        const viewingAsUserId = useIdentityStore.getState().viewingAsUserId;
        const n = tasks.filter(
          (t) => t.status === "done" && !t.reviewedBy && canReviewTask(t.departmentIds, viewingAsUserId)
        ).length;
        setCount(n);
      } catch {
        // Best-effort — a failed fetch just leaves the tile without a badge.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-(--danger) px-1 text-[10px] font-bold text-white ring-2 ring-(--bg)"
      aria-label={`มีงานรอตรวจ ${count} รายการ`}
      title={`มีงานรอตรวจ ${count} รายการ`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
