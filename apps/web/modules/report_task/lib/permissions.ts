import { canManage, departments, getUser, isOwner } from "@/modules/report_task/lib/directory";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import type { GrantableSection } from "@/modules/report_task/store/settings-access-store";
import type { ChecklistItem, Task } from "@/modules/report_task/types";

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
 * Who can mark a done-but-unreviewed task ("รอตรวจสอบ") as ผ่าน/ไม่ผ่าน —
 * deliberately narrower than canEditRecord: the company-wide owner or a head
 * of a department the task touches, but NOT just whoever assigned/created
 * it. Reviewing your own assignment defeats the point of a sign-off ("คนที่
 * มอบหมายงานหรือ ceo" — decided it should be ceo + หัวหน้าแผนก only, an
 * assigner who happens to also be a head still qualifies through that).
 */
export function canReviewTask(recordDepartmentIds: (string | undefined)[], viewingAsUserId: string): boolean {
  if (isOwner(viewingAsUserId)) return true;
  const deptIds = new Set(recordDepartmentIds.filter((id): id is string => !!id));
  return departments.some((d) => d.headId === viewingAsUserId && deptIds.has(d.id));
}

/**
 * A missed-deadline dock is meant to carry no discretion — every task docks
 * automatically the instant it's overdue (see task-penalty-sweep.ts), so
 * there's no manual "case by case" dock anymore. Only the company-wide owner
 * can cancel an automatic dock, and the caller is expected to require a
 * stated reason too, so overriding it leaves a trail.
 */
export function canOverrideAutoPenalty(viewingAsUserId: string): boolean {
  return isOwner(viewingAsUserId);
}

/**
 * Whether the missed-deadline penalty status (heading, explanation, chip)
 * should render at all for this viewer. An existing penalty is a fact about
 * the task — everyone who can see the task sees it, override rights or not,
 * otherwise the task's own assignee wouldn't know their score took a hit.
 * But an *offer* to (re)dock one (no penalty yet, just overdue — e.g. an
 * owner already cancelled the automatic one) is a pure action affordance —
 * showing it to someone who can't act on it is a disabled control with
 * nothing behind it, so it stays hidden for them instead.
 */
export function canSeePenaltyStatus(task: Task, viewingAsUserId: string): boolean {
  if (task.penalty) return true;
  return dueUrgency(task) === "overdue" && canOverrideAutoPenalty(viewingAsUserId);
}

/**
 * Ticking a checklist item off (not editing its text, not adding/removing
 * items — that's `canEditRecord` territory, same as the rest of a task's
 * structure) belongs to whoever owns it, plus the company-wide owner (CEO) —
 * who can already see and edit every task anyway, and needs to be able to
 * verify/correct a checklist directly instead of only nagging the owner to
 * tick it themselves. Everyone else on a group task can still see a
 * teammate's items, just not check them on their behalf.
 */
export function canToggleOwnChecklistItem(item: ChecklistItem, viewingAsUserId: string): boolean {
  return item.ownerId === viewingAsUserId || isOwner(viewingAsUserId);
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
 * though canEditRecord already correctly scoped them out of editing those
 * same tasks — visibility and edit rights now agree.)
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
 * every task everyone else has, whether or not the viewer is involved. This
 * function's own default is the same rule for every role: only tasks the
 * viewer is assigned to, or personally assigned to someone else. A manager
 * can still opt into the wider canSeeTask scope for their calendar via the
 * "mine"/"all" toggle in calendar-scope-store.ts — that's a deliberate
 * per-viewer choice made at the call site, not something this function does.
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

// ---------------------------------------------------------------------------
// Issue-report / support-desk permissions (ISSUE_REPORT_SYSTEM_SPEC.md §2).
// Pure functions taking a plain `IssueDeskConfig` shape, same pattern as the
// report-feed helpers above — never reach into a store from in here.
// ---------------------------------------------------------------------------

/**
 * Retired — issue management moved off every company entirely and onto
 * SmartBoss's own platform Super Admin console (`/admin/issue-reports`), so
 * there's no more in-company "IT desk" step between an employee and the
 * people who actually fix things ("ไม่เอาแบบเดิมที่พนักงานแจ้ง IT แล้ว IT
 * แจ้งเรา...แจ้งตรงหาเราเราแก้ให้เลย"). Always false now — every caller
 * below (`canSeeIssue`, `canManageIssue`, etc.) collapses correctly on its
 * own once this never fires; kept as a function (not deleted) so none of
 * those call sites or their `cfg` parameter need touching. `cfg`'s
 * `recipientDepartmentIds`/`extraAgentUserIds` fields are vestigial as of
 * this change — still read/written by the desk-config store, just no
 * longer consulted for who can manage a ticket.
 */
export function isIssueAgent(
  _cfg: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] },
  _userId: string
): boolean {
  return false;
}

/**
 * Whether `userId` can open a ticket at all: its own reporter, anyone with
 * read-only company-wide oversight (see `canViewCompanyIssues` — the
 * CEO/owner, or whoever they've delegated the "issueDesk" section to,
 * typically the IT position), or — for a `public_in_org` ticket (a
 * company-wide outage, say) — anyone, so the same incident doesn't get
 * reported 20 separate times.
 *
 * This is deliberately NOT the retired in-company Agent desk (see
 * `isIssueAgent`) — oversight is read-only (see `canSeeIssueMessage` below,
 * which still hides staff notes from it); nobody inside the reporter's own
 * company can claim/reply-as-staff/change status on someone else's ticket
 * through this. Only SmartBoss's platform Super Admin console can act on a
 * ticket cross-org now (via its own separate data path, not this function).
 */
export function canSeeIssue(
  ticket: { reporterId: string; visibility: "private" | "public_in_org" },
  _cfg: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] },
  userId: string,
  canOverseeCompanyIssues = false
): boolean {
  if (ticket.reporterId === userId) return true;
  if (canOverseeCompanyIssues) return true;
  return ticket.visibility === "public_in_org";
}

/**
 * A message's `audience` gates it independently of ticket-level visibility —
 * seeing the ticket doesn't mean seeing every message on it. `"all"` is open
 * to anyone who can see the ticket (including the reporter and a company
 * overseer — see `canSeeIssue`); `"staff"` and `"vendor"` are
 * SmartBoss-internal notes now (written from the admin console), so nobody
 * inside the reporter's own company — owner and IT-position overseer
 * included — sees them here.
 */
export function canSeeIssueMessage(
  msg: { audience: "all" | "staff" | "vendor" },
  ticket: { reporterId: string; visibility: "private" | "public_in_org" },
  cfg: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] },
  userId: string,
  canOverseeCompanyIssues = false
): boolean {
  if (!canSeeIssue(ticket, cfg, userId, canOverseeCompanyIssues)) return false;
  return msg.audience === "all";
}

/** Status / priority / assignee / tags / visibility — retired for every
 * company (see `isIssueAgent`); always false. That workflow now lives only
 * in SmartBoss's own admin console, gated there by `isSuperAdmin()`, not by
 * this function. */
export function canManageIssue(
  _cfg: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] },
  _userId: string
): boolean {
  return false;
}

/**
 * A ticket can only be escalated once it's actually been triaged — not a
 * shortcut straight from "new" — so a raw, unlooked-at report never lands on
 * the vendor's desk (see POST_TRIAGE_STATUSES in lib/issue-meta.ts / the
 * state machine in the spec). Already-escalated tickets can't be escalated
 * again.
 */
export function canEscalateIssue(
  ticket: { status: string; escalatedAt: string | null },
  cfg: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] },
  userId: string,
  postTriageStatuses: string[]
): boolean {
  if (!canManageIssue(cfg, userId)) return false;
  return ticket.escalatedAt === null && postTriageStatuses.includes(ticket.status);
}

/**
 * The `pending_verify` → `resolved`/reopen call belongs to the reporter — they're
 * the one who knows whether it's actually fixed. "Confirm on the reporter's
 * behalf" is now a SmartBoss-admin-console-only capability (see
 * `isIssueAgent`), not something anyone inside the reporter's own company —
 * owner included — can do here.
 */
export function canConfirmResolution(
  ticket: { reporterId: string },
  _cfg: { recipientDepartmentIds: string[]; extraAgentUserIds: string[] },
  userId: string
): boolean {
  return ticket.reporterId === userId;
}

/** Only the reporter can close their own ticket outright (mark it resolved
 * themselves — e.g. they fixed it on their own end) — nobody else's report. */
export function canReporterCloseOwnIssue(ticket: { reporterId: string }, userId: string): boolean {
  return ticket.reporterId === userId;
}

export function canManageIssueDeskSettings(userId: string, grants: Record<string, GrantableSection[]>): boolean {
  return isOwner(userId) || canAccessCompanySection("issueDesk", userId, grants);
}

/**
 * Read-only company-wide oversight — the CEO/owner, or whoever they've
 * delegated the "issueDesk" section to (in practice, usually whoever holds
 * the IT position), can see every ticket anyone in the company has filed
 * and its current status — a running record of what's been reported and
 * whether it's been fixed ("เก็บไว้ให้ตำแหน่ง IT กับ CEO ดูได้ว่าแจ้งอะไร
 * ไปบ้างและได้รับการแก้ไขรึยังไง"). Reuses the same delegation
 * `canManageIssueDeskSettings` already grants for the intake-form settings
 * panel, rather than inventing a second grant — same trusted circle either
 * way. This is deliberately narrower than the retired in-company Agent
 * desk (`isIssueAgent`): it only ever grants *seeing* the ticket + its
 * "all"-audience thread (see `canSeeIssue`/`canSeeIssueMessage`), never
 * claiming, replying as staff, or changing status/priority — that stays
 * SmartBoss-admin-console-only.
 */
export function canViewCompanyIssues(userId: string, grants: Record<string, GrantableSection[]>): boolean {
  return canManageIssueDeskSettings(userId, grants);
}

/**
 * A narrow, metadata-only visibility for a department head — NOT the same as
 * `canSeeIssue` (which grants the full thread). A head over the reporter's
 * department can see this ticket in their "ของทีมฉัน" roll-up (title/status/
 * age only, see the list page) when the reporter left `shareWithHead` on;
 * they still can't open the thread, read notes, or manage the ticket in any
 * way through this — that stays Agent/owner-only. See
 * ISSUE_DESK_AUDIT_2026-08-08.md §C3 for why this is deliberately thinner
 * than full ticket access, not a shortcut to it.
 */
export function canSeeIssueSummaryAsHead(
  ticket: { reporterId: string; shareWithHead: boolean },
  viewingAsUserId: string
): boolean {
  if (!ticket.shareWithHead) return false;
  const reporterDeptId = getUser(ticket.reporterId)?.departmentId;
  if (!reporterDeptId) return false;
  return departments.some((d) => d.id === reporterDeptId && d.headId === viewingAsUserId);
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
