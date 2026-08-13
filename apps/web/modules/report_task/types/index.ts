// Core domain types for EasyBoss Workspace

export type TaskStatus = "todo" | "in_progress" | "done";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface Department {
  id: string;
  name: string;
  color: string;
  headId: string;
}

/** Optional grouping tag for tasks — no permission implications, purely a
 * label. Not every org uses these; a task with no `projectTopicId` is fine. */
export interface ProjectTopic {
  id: string;
  name: string;
  color?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  departmentId: string;
  /** Sees/edits everything company-wide — not scoped to one department like a department head. */
  isOwner?: boolean;
}

export interface RevisionEntry {
  revisionNumber: number;
  previousDate: string;
  newDate: string;
  reason: string;
  revisedBy: string;
  revisedAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: string;
  type: string;
  uploadedBy: string;
  uploadedAt: string;
  /** Uploaded image preview — only set for actual picked images; other file
   * types are metadata-only. Server path from /api/uploads. */
  url?: string;
  /** Legacy inline preview from before uploads went through /api/uploads —
   * kept so old data (seed/demo tasks) still renders; new attachments use
   * `url` instead. Prefer `url ?? dataUrl` when rendering. */
  dataUrl?: string;
}

export interface Comment {
  id: string;
  authorId: string;
  message: string;
  createdAt: string;
  attachments?: Attachment[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Who this item belongs to — an individual task's items all share the one
   * assignee; a group task splits its checklist into one section per person.
   * Drives `completedAssigneeIds` (see task-completion.ts): an assignee's
   * part is done once every item they own is checked. */
  ownerId?: string;
}

export interface Sticker {
  id: string;
  emoji: string;
  label: string;
  points: number;
  builtin?: boolean;
}

export interface TaskReaction {
  id: string;
  stickerId: string;
  byUserId: string;
  note?: string;
  createdAt: string;
}

/**
 * A discretionary missed-deadline dock. This is deliberately NOT a sticker:
 * stickers are casual reactions, while this is a lead's case-by-case judgement
 * on an overdue task, so it lives as its own status on the task.
 */
export interface TaskPenalty {
  points: number;
  byUserId: string;
  appliedAt: string;
  reason?: string;
}

export interface Task {
  id: string;
  /** Human-readable task number, e.g. "T-2569-0001" — assigned once, server-side
   * only, atomically at creation (see task-repo.ts's writeTasks/nextTaskCode).
   * Never set by the client; absent until the server round-trip that created
   * the task confirms it (see task-sync.tsx merging `codes` off the save
   * response). */
  code?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Set explicitly at creation, not re-derived from assigneeIds.length later
   * — a lead could in principle drop a group task down to one remaining
   * assignee without it silently becoming "individual". */
  taskMode: "individual" | "group";
  assigneeIds: string[];
  /** Which of `assigneeIds` is the lead on a group task — a label only, no
   * permission implications (edit rights still come from `assignedById`/
   * department head, see canEditRecord). Unused on an individual task. */
  mainAssigneeId?: string;
  assignedById: string;
  departmentIds: string[];
  startDate: string;
  dueDate: string;
  originalDueDate: string;
  /** Per-assignee due-date override for a group task — falls back to
   * `dueDate` for anyone not listed here. Unused on an individual task. */
  assigneeDueDates?: Record<string, string>;
  /** History of `assigneeDueDates` edits, keyed by assignee id — only the
   * first-ever date and the latest revision are kept (not every round in
   * between, unlike the whole-task `revisions` list), since this is a quick
   * per-person adjustment rather than a formal re-plan. */
  assigneeDueDateRevisions?: Record<
    string,
    { originalDate: string; latestDate: string; revisedBy: string; revisedAt: string }
  >;
  /** Set the moment status transitions to "done"; cleared if reopened. Lets the missed-deadline sweep judge a *finished* task by when it actually closed, not by "today" (which would eventually brand every old task late). */
  completedAt?: string;
  /** True once this task has gone overdue at least once — sticks even if later docked, resolved, or pushed out, so a flexible task's history isn't lost. */
  missedDeadlineOnce?: boolean;
  /** True once this task has been taken out of "เสร็จสิ้น" after being marked done — sticks forever, even once it's properly finished again, as a visible flag against a "mark done to dodge the deadline" pattern. */
  reopenedOnce?: boolean;
  /** Which of this task's assignees (a subset of assigneeIds) have marked
   * their own part done — only meaningful when assigneeIds.length > 1. The
   * task's own `status` only flips to "done" once every assignee is in
   * here; unmarking one flips it back to "in_progress". A single-assignee
   * task ignores this and moves status directly, same as before. */
  completedAssigneeIds?: string[];
  attachments: Attachment[];
  comments: Comment[];
  revisions: RevisionEntry[];
  reactions: TaskReaction[];
  /** Set automatically the moment a task goes overdue (see task-penalty-sweep.ts) — every task docks the same way, no manual/case-by-case path. Individual tasks only — a group task docks per assignee via `penalties` instead. */
  penalty?: TaskPenalty | null;
  /** Per-assignee dock map for a group task (userId -> their own penalty) —
   * each assignee is judged against their own effective due date and only
   * docked if they personally haven't finished. Individual tasks use the
   * singular `penalty` field instead, never this. */
  penalties?: Record<string, TaskPenalty>;
  checklist: ChecklistItem[];
  /** Planner's "show on card" — preview the checklist on the board card. */
  showChecklistOnCard: boolean;
  /** Optional grouping tag (see ProjectTopic) — most tasks have none. */
  projectTopicId?: string;
  createdAt: string;
  updatedAt: string;
}

export type CalendarEventType = "task" | "leave" | "meeting" | "holiday" | "google" | "dayoff";

/** Leave-type id — configurable at runtime (see leave-type-store). */
export type LeaveType = string;

export interface CalendarEvent {
  id: string;
  title: string;
  type: CalendarEventType;
  start: string;
  end: string;
  allDay: boolean;
  userId?: string;
  /** First of `departmentIds`, kept for callers that only care about one. */
  departmentId?: string;
  /** All departments this event touches — for a meeting, derived from its attendees. */
  departmentIds?: string[];
  /** Meeting attendees (person picker) — leave/holiday/task events don't use this. */
  attendeeIds?: string[];
  /** Who created this meeting — only they can edit/delete it (leave uses `userId` for the same purpose). */
  createdById?: string;
  leaveType?: LeaveType;
  taskId?: string;
  location?: string;
  description?: string;
  /** Overrides the type color (e.g. task events tinted red when overdue). */
  colorHint?: string;
  /** True for events already in the past — rendered as a paler version of its own color. */
  muted?: boolean;
  /** True when the viewer is on this event (task assignee, meeting attendee/creator, leave owner) — filled dot vs hollow for someone else's. */
  mine?: boolean;
  /** True if the viewer can drag this to reschedule (creator or department head) — computed once here so the calendar doesn't even let the drag start otherwise. */
  editable?: boolean;
  /** Files attached at creation/edit time — meeting only for now. */
  attachments?: Attachment[];
}

export interface ActivityItem {
  id: string;
  userId: string;
  action: string;
  target: string;
  /** Extra "how" context — e.g. "-3 คะแนน", "21 ก.ค. 2026 → 27 ก.ค. 2026", a reason string. */
  detail?: string;
  taskId?: string;
  createdAt: string;
}

export interface ScoreBreakdown {
  base: number;
  latePenalty: number;
  revisionPenalty: number;
  /** Sum of discretionary missed-deadline docks a lead applied (Task.penalty). */
  manualPenalty: number;
  stickerAdjustment: number;
  total: number;
}

export interface UserReport {
  userId: string;
  assignedTasks: number;
  completedTasks: number;
  lateTasks: number;
  completionRate: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  avgCompletionTime: number;
  revisionCount: number;
}

export interface DepartmentReport {
  departmentId: string;
  assignedTasks: number;
  completedTasks: number;
  lateTasks: number;
  completionRate: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  avgCompletionTime: number;
  revisionCount: number;
}
