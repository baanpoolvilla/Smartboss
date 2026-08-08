import { canManage, departments, getUser, isOwner } from "@/modules/report_task/data/mock";
import { dueUrgency, isSuspiciousRevision } from "@/modules/report_task/lib/task-flags";
import type { GrantableSection } from "@/modules/report_task/store/settings-access-store";
import type { Task } from "@/modules/report_task/types";

/**
 * Who can edit a record's core/main data: whoever created it, the head of
 * any department the record touches, or the company-wide owner (unlike a
 * department head, not scoped to any one department) — a stand-in for a real
 * role/permission system (there's no login yet; this simulates it off the
 * `viewingAs` identity switcher so it's ready to swap for real auth+roles later).
 */
export function canEditRecord(
  creatorId: string | undefined,
  recordDepartmentIds: (string | undefined)[],
  viewingAsUserId: string
): boolean {
  if (isOwner(viewingAsUserId)) return true;
  if (creatorId && creatorId === viewingAsUserId) return true;
  const deptIds = new Set(recordDepartmentIds.filter((id): id is string => !!id));
  return departments.some((d) => d.headId === viewingAsUserId && deptIds.has(d.id));
}

/**
 * Docking a missed-deadline penalty is a supervisory call — the head of any
 * department the task touches, the owner, or whoever assigned the task can
 * dock/undock it. (Previously excluded the assigner unless they were also a
 * head/owner; widened on request so the person who actually handed the work
 * out doesn't have to go find a department head to flag a missed deadline.)
 */
export function canDockPenalty(
  assignedById: string,
  recordDepartmentIds: (string | undefined)[],
  viewingAsUserId: string
): boolean {
  if (isOwner(viewingAsUserId)) return true;
  if (assignedById === viewingAsUserId) return true;
  const deptIds = new Set(recordDepartmentIds.filter((id): id is string => !!id));
  return departments.some((d) => d.headId === viewingAsUserId && deptIds.has(d.id));
}

/**
 * An automatic strict-deadline dock is meant to carry no discretion — unlike
 * a flexible task's manual dock (any department head over it can toggle
 * that), only the company-wide owner can cancel one, and the caller is
 * expected to require a stated reason too, so overriding it leaves a trail.
 */
export function canOverrideAutoPenalty(viewingAsUserId: string): boolean {
  return isOwner(viewingAsUserId);
}

/**
 * Whether the missed-deadline penalty status (heading, explanation, chip)
 * should render at all for this viewer. An existing penalty is a fact about
 * the task — everyone who can see the task sees it, dock rights or not,
 * otherwise the task's own assignee wouldn't know their score took a hit.
 * But an *offer* to dock one (no penalty yet, just overdue or repeatedly
 * pushed out) is a pure action affordance — showing it to someone who can't
 * act on it is a disabled control with nothing behind it, so it stays hidden
 * for them instead.
 */
export function canSeePenaltyStatus(task: Task, viewingAsUserId: string): boolean {
  if (task.penalty) return true;
  const isStrict = (task.deadlineType ?? "flexible") === "strict";
  if (isStrict) {
    return dueUrgency(task) === "overdue" && canOverrideAutoPenalty(viewingAsUserId);
  }
  const dockable = dueUrgency(task) === "overdue" || isSuspiciousRevision(task);
  return dockable && canDockPenalty(task.assignedById, task.departmentIds, viewingAsUserId);
}

/**
 * A sticker is evidence of a lead's call, not clutter the recipient can tidy
 * away — only whoever handed it out, a department head over the task, or the
 * owner can remove it. Without this, anyone with the task open (including
 * whoever the sticker was about) could quietly delete a reprimand.
 */
export function canRemoveReaction(
  reactionByUserId: string,
  recordDepartmentIds: (string | undefined)[],
  viewingAsUserId: string
): boolean {
  if (isOwner(viewingAsUserId)) return true;
  if (reactionByUserId === viewingAsUserId) return true;
  const deptIds = new Set(recordDepartmentIds.filter((id): id is string => !!id));
  return departments.some((d) => d.headId === viewingAsUserId && deptIds.has(d.id));
}

/**
 * Task-list visibility: the owner sees everything, company-wide. A
 * department head sees their own tasks (assignee/creator) plus anything
 * touching a department they head — NOT every task in the company. (This
 * used to just check isDepartmentHead() and skip the department match
 * entirely, so any head could see every other department's tasks even
 * though canEditRecord/canDockPenalty already correctly scoped them out of
 * editing those same tasks — visibility and edit rights now agree.)
 * Everyone else only sees tasks they're on. Applied everywhere a task list
 * renders (board, table, workload, search) — the calendar uses the stricter
 * canSeeTaskOnCalendar below instead.
 */
export function canSeeTask(
  task: Pick<Task, "assigneeIds" | "assignedById" | "departmentIds">,
  viewingAsUserId: string
): boolean {
  if (isOwner(viewingAsUserId)) return true;
  if (task.assigneeIds.includes(viewingAsUserId) || task.assignedById === viewingAsUserId) return true;
  const deptIds = new Set(task.departmentIds.filter(Boolean));
  return departments.some((d) => d.headId === viewingAsUserId && deptIds.has(d.id));
}

/**
 * Calendar-only task visibility — deliberately narrower than canSeeTask.
 * Owner/department-head broad visibility (see everything company-wide, or
 * everything touching a department they head) makes sense on the board where
 * you're managing a department's work, but floods a personal calendar with
 * every task everyone else has, whether or not the viewer is involved. Same
 * rule for every role: only tasks the viewer is assigned to, or personally
 * assigned to someone else — a head/owner's calendar shows exactly what a
 * regular employee's already does.
 */
export function canSeeTaskOnCalendar(
  task: Pick<Task, "assigneeIds" | "assignedById">,
  viewingAsUserId: string
): boolean {
  return task.assigneeIds.includes(viewingAsUserId) || task.assignedById === viewingAsUserId;
}

/**
 * Room-level visibility for report feed topics — a room can be scoped to one
 * or more departments, to managers only, or left open (no `visibility`, or
 * both fields empty — the default every topic had before this existed, so
 * nothing already-persisted silently locks out). The owner always sees
 * everything. Takes a plain visibility shape rather than a `ReportTopic` so
 * this stays a generic permissions helper, not coupled to that store's type.
 */
export function canSeeReportTopic(
  visibility: { departmentIds?: string[]; managerOnly?: boolean; userIds?: string[]; extraUserIds?: string[] } | undefined,
  viewingAsUserId: string
): boolean {
  if (isOwner(viewingAsUserId)) return true;
  if (!visibility || (!visibility.managerOnly && !visibility.departmentIds?.length && !visibility.userIds?.length)) return true;
  if (visibility.userIds?.length) return visibility.userIds.includes(viewingAsUserId);
  if (visibility.managerOnly && !canManage(viewingAsUserId)) return false;
  if (visibility.departmentIds?.length) {
    const dept = getUser(viewingAsUserId)?.departmentId;
    const inDept = !!dept && visibility.departmentIds.includes(dept);
    const inExtra = visibility.extraUserIds?.includes(viewingAsUserId) ?? false;
    if (!inDept && !inExtra) return false;
  }
  return true;
}

/**
 * Whether someone is actually *expected* to post in this room — narrower
 * than `canSeeReportTopic`. The owner sees every room (so they can check up
 * on it), but that blanket visibility isn't the same as being one of the
 * people who owes it a report: a CEO isn't a rank-and-file member of
 * "ฝ่ายขาย" just because they can see the room. Report-compliance
 * calculations (report-feed-compliance.ts) use this instead of
 * canSeeReportTopic so the owner never shows up as "missed" in every
 * department's room — only real members of a room count as obligated.
 * Same idea covers `exemptUserIds`: someone deliberately looped into a room
 * to see/participate (an observer/advisor) without being on the hook for
 * its posting schedule.
 */
export function mustReportToTopic(
  visibility: { departmentIds?: string[]; managerOnly?: boolean; userIds?: string[]; extraUserIds?: string[]; exemptUserIds?: string[] } | undefined,
  userId: string
): boolean {
  if (isOwner(userId)) return false;
  if (visibility?.exemptUserIds?.includes(userId)) return false;
  return canSeeReportTopic(visibility, userId);
}

/**
 * Who can EDIT a room's settings (cutoffs, min images, visibility) — much
 * narrower than who can just see/post in it. The owner can edit any room; a
 * department head can only edit one scoped specifically to (one or more of)
 * their own department, never a company-wide room ("ทุกคน"), a cross-functional
 * manager-only room, a person-specific room, or another department's room —
 * those have a blast radius beyond the head's own team, same reasoning as
 * routine-day-off quotas being owner-only.
 */
/**
 * Whether `viewingAsUserId` can see/use a company-tab settings section
 * (stickers, leave types, routine day-off) in settings/page.tsx — the owner
 * always can, and the owner can additionally delegate individual sections to
 * specific employees (see settings-access-store) without making them a
 * department head or owner. `grants` is that store's per-user map, passed in
 * rather than read here so this stays a plain function callers can memoize on.
 */
export function canAccessCompanySection(
  section: GrantableSection,
  viewingAsUserId: string,
  grants: Record<string, GrantableSection[]>
): boolean {
  if (isOwner(viewingAsUserId)) return true;
  return grants[viewingAsUserId]?.includes(section) ?? false;
}

/**
 * Who can create or delete a report topic/sub-topic at all — the CEO by
 * default, plus anyone the CEO has specifically delegated the "reportTopics"
 * section to (see settings-access-store), same delegation shape as every
 * other owner-only company setting. Deliberately narrower than
 * `canEditReportTopic` (which also lets a department head edit a room
 * scoped to their own department) — creating/deleting rooms reshapes the
 * whole company's room list, not just one department's, so it doesn't get
 * the same automatic department-head carve-out.
 */
export function canManageReportTopics(viewingAsUserId: string, grants: Record<string, GrantableSection[]>): boolean {
  return isOwner(viewingAsUserId) || canAccessCompanySection("reportTopics", viewingAsUserId, grants);
}

export function canEditReportTopic(
  visibility: { departmentIds?: string[]; managerOnly?: boolean; userIds?: string[] } | undefined,
  viewingAsUserId: string
): boolean {
  if (isOwner(viewingAsUserId)) return true;
  // Head of one of the room's departments — not just any member of it. This
  // used to check department membership alone, so any regular employee in a
  // department-scoped room's department got the room's settings/edit access,
  // not just their head.
  const deptIds = new Set(visibility?.departmentIds ?? []);
  return departments.some((d) => d.headId === viewingAsUserId && deptIds.has(d.id));
}
