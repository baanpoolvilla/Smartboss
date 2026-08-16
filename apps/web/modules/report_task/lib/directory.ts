import type { Department, User } from "@/modules/report_task/types";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";

// `departments`/`users` are live views over useDepartmentStore/useEmployeeStore
// (the real, owner-editable, server-synced org data — see
// components/shared/org-settings-panel.tsx), not static data. A Proxy
// forwards every array access (`.map`, `.find`, `.some`, `.length`, ...) to
// `.getState()` on each read, so every call site below (and every other file
// in the app that does `departments.map(...)` / `users.find(...)`) always
// sees current data with no refactor needed at any call site. The one thing
// this does NOT do is force a React re-render purely because the store
// changed elsewhere; components that need that (the org settings panel, the
// identity switcher) read the store's hook directly instead.
function liveArrayProxy<T>(getLive: () => T[]): T[] {
  return new Proxy([] as T[], {
    get: (_target, prop, receiver) => Reflect.get(getLive(), prop, receiver),
    // `map`/`filter`/`some`/`forEach`/etc. all call HasProperty on each index
    // before reading it (to skip holes in sparse arrays) — without this trap
    // that check falls through to the permanently-empty dummy target, so
    // every index reads as "missing" and those methods silently no-op.
    has: (_target, prop) => Reflect.has(getLive(), prop),
  });
}

export const departments: Department[] = liveArrayProxy(() => useDepartmentStore.getState().departments);
export const users: User[] = liveArrayProxy(() => useEmployeeStore.getState().employees);

export function getUser(id: string) {
  return users.find((u) => u.id === id);
}
export function getDepartment(id: string) {
  return departments.find((d) => d.id === id);
}
export function isDepartmentHead(userId: string) {
  return departments.some((d) => d.headId === userId);
}
export function isOwner(userId: string) {
  return getUser(userId)?.isOwner === true;
}
/** Anyone with manager-level UI access — a department head or the company-wide owner. */
export function canManage(userId: string) {
  return isDepartmentHead(userId) || isOwner(userId);
}
/** Departments this user heads — the "own only" boundary reused by every scoped view below. */
export function headedDepartmentIds(userId: string): Set<string> {
  return new Set(departments.filter((d) => d.headId === userId).map((d) => d.id));
}
/**
 * Departments a viewer has rights to see: the owner sees the whole company,
 * a department head sees only the department(s) they head, everyone else
 * sees none (dashboard/workload/activity-log gate this view to managers
 * anyway — the Task Board is the one surface where a regular staffer still
 * needs *something* pickable, so it layers its own self-only fallback on top
 * instead of relying on this returning something for them).
 */
export function scopedDepartments(userId: string): Department[] {
  if (isOwner(userId)) return [...departments];
  const headed = headedDepartmentIds(userId);
  return departments.filter((d) => headed.has(d.id));
}
/** Same scope as {@link scopedDepartments}, but the people inside it. */
export function scopedUsers(userId: string): User[] {
  if (isOwner(userId)) return [...users];
  const headed = headedDepartmentIds(userId);
  return users.filter((u) => headed.has(u.departmentId));
}
export function headOfDepartment(departmentId: string) {
  const dept = departments.find((d) => d.id === departmentId);
  return dept ? dept.headId : users[0]?.id;
}
/** Unique departments covered by a set of users — a task's departments follow its assignees. */
export function departmentIdsOf(userIds: string[]): string[] {
  const set = new Set<string>();
  for (const id of userIds) {
    const dep = users.find((u) => u.id === id)?.departmentId;
    if (dep) set.add(dep);
  }
  return [...set];
}
