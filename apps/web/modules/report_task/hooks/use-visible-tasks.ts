"use client";

import { useMemo } from "react";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";

/**
 * canSeeTask อ่านรายชื่อ/แผนก (เจ้าของบริษัท? หัวหน้าแผนก?) ผ่าน proxy ที่ไม่ reactive — ใส่ค่านี้ใน deps ของ useMemo
 * ที่คัดงานด้วยสิทธิ์ ไม่งั้นงานที่โหลดเสร็จก่อนรายชื่อถูกคัดด้วยสิทธิ์ "พนักงานทั่วไป" แล้วค้างอย่างนั้น
 * (24/11/2569: CEO เปิดบอร์ดเห็นแค่งานตัวเอง 9 จาก 147 จนกว่าจะมีงานเปลี่ยน)
 */
export function useDirectoryDeps(): readonly [unknown, unknown] {
  const employees = useEmployeeStore((s) => s.employees);
  const departments = useDepartmentStore((s) => s.departments);
  return [employees, departments] as const;
}

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
  const [employees, departments] = useDirectoryDeps();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- employees/departments อ่านผ่าน proxy ใน canSeeTask
  return useMemo(() => tasks.filter((t) => canSeeTask(t, viewingAsUserId)), [tasks, viewingAsUserId, employees, departments]);
}
