"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { getUser, getDepartment } from "@/modules/report_task/lib/directory";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useCalendarScopeStore } from "@/modules/report_task/store/calendar-scope-store";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { formatDate, formatDateTime } from "@/modules/report_task/lib/format";
import { todayIso } from "@/modules/report_task/lib/now";
import { rangeLabel, inRange, inRangeLocal, type ViewRange } from "@/modules/report_task/lib/date-filter";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { canManage } from "@/modules/report_task/lib/directory";
import { canSeeTask, canSeeTaskOnCalendar } from "@/modules/report_task/lib/permissions";
import { cn } from "@/modules/report_task/lib/utils";
import { User, Check, Plus } from "lucide-react";
import type { CalendarEvent, Task, TodoItem } from "@/modules/report_task/types";

/** Right rail for the work calendar: the visible range's tasks (by due date) + meetings. */
export function WorkSidebar({
  range,
  onOpenTask,
  onToggleTodo,
  onEditTodo,
  onAddTodo,
}: {
  range: ViewRange;
  onOpenTask: (id: string) => void;
  /** สิ่งที่ต้องทำ now lives inside "งานที่ฉันรับ" (asked for explicitly:
   *  "สิ่งที่ต้องทำ จะเอาเข้ามาอยู่ด้วย ในงานที่ฉันรับ") instead of its own
   *  separate card — same toggle/edit/add handlers TodoSidebar used to own. */
  onToggleTodo: (id: string) => void;
  onEditTodo: (t: TodoItem) => void;
  onAddTodo: () => void;
}) {
  const tasks = useTaskStore((s) => s.tasks);
  const meetings = useMeetingStore((s) => s.meetings);
  const todos = useTodoStore((s) => s.todos);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const taskScope = useCalendarScopeStore((s) => s.scope);
  const canBroadenScope = canManage(viewingAsUserId);
  const colors = useEventColorStore((s) => s.colors);

  const monthTasks = tasks
    .filter(
      (t: Task) =>
        t.status !== "done" &&
        inRange(t.dueDate, range) &&
        t.assigneeIds.some((id) => !hiddenUserIds.includes(id)) &&
        (taskScope === "all" && canBroadenScope ? canSeeTask(t, viewingAsUserId) : canSeeTaskOnCalendar(t, viewingAsUserId))
    )
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const monthMeetings = meetings
    .filter(
      (m) =>
        inRangeLocal(m.start, range) && (!m.attendeeIds?.length || m.attendeeIds.some((id) => !hiddenUserIds.includes(id)))
    )
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // A to-do already done and dated before today is finished business — same
  // "not done" gate monthTasks applies below, just checked per-item instead
  // of by status since to-dos don't have one. A past, still-*unfinished*
  // to-do stays visible on purpose: that's the one that actually needs
  // attention, same reasoning as an overdue task staying on the board.
  const todayYmd = todayIso();
  const notStaleDone = (t: TodoItem) => !(t.done && t.date < todayYmd);

  const myTodos = todos
    .filter((t) => t.userId === viewingAsUserId && inRange(t.date, range) && notStaleDone(t))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date));

  // Everyone else's to-dos in range — folded into the crowd card below so it
  // reads as "everything happening this month", not just tasks (asked for
  // explicitly: "งานทั้งเดือนนี้ให้มีสิ่งที่ต้องทำของคนอื่นเข้ามา รวมกันเลย").
  const otherTodos = todos
    .filter(
      (t) => t.userId !== viewingAsUserId && inRange(t.date, range) && !hiddenUserIds.includes(t.userId) && notStaleDone(t)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  // Mine = attending or created it — same "what's actually mine" scoping as
  // myTasks below, now that meetings merge into the same list instead of
  // their own separate card.
  const myMeetings = monthMeetings.filter(
    (m) => (m.attendeeIds ?? []).includes(viewingAsUserId) || m.createdById === viewingAsUserId
  );

  // Assignee-only — was assignee-OR-assigner ("a task I handed to someone
  // else is just as much mine as one handed to me"), reversed on explicit
  // feedback: this card should read as "what's actually on my plate",
  // not include tasks the viewer created/assigned but doesn't have to do
  // themselves ("งานที่เราแอดเค้าไปไม่เอามา เอาแค่งานที่เค้าแอดเราพอแล้ว").
  const myTasks = monthTasks.filter((t) => t.assigneeIds.includes(viewingAsUserId));

  // Merged, date-sorted personal list — งาน/ประชุม/สิ่งที่ต้องทำ all read as
  // one "what's on my plate" list now instead of separate cards (asked for
  // explicitly: "เอารวมกันเลยเป็นงานที่ฉันได้รับ").
  type PersonalItem = { date: string } & (
    | { kind: "task"; task: Task }
    | { kind: "todo"; todo: TodoItem }
    | { kind: "meeting"; meeting: CalendarEvent }
  );
  const myItems: PersonalItem[] = [
    ...myTasks.map((t): PersonalItem => ({ kind: "task", date: t.dueDate, task: t })),
    ...myTodos.map((t): PersonalItem => ({ kind: "todo", date: t.date, todo: t })),
    ...myMeetings.map((m): PersonalItem => ({ kind: "meeting", date: m.start, meeting: m })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const period = range.viewType === "timeGridDay" ? "วันนี้" : range.viewType === "timeGridWeek" ? "สัปดาห์นี้" : "เดือนนี้";
  const myHeading = range.viewType === "timeGridDay" ? "งานที่ฉันได้รับวันนี้" : range.viewType === "timeGridWeek" ? "งานที่ฉันได้รับสัปดาห์นี้" : "งานที่ฉันได้รับเดือนนี้";
  const emptyTasksLabel = range.viewType === "timeGridDay" ? "ไม่มีงานครบกำหนดวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีงานครบกำหนดสัปดาห์นี้" : "ไม่มีงานครบกำหนดในเดือนนี้";
  const emptyMyTasksLabel = range.viewType === "timeGridDay" ? "ไม่มีงาน ประชุม หรือสิ่งที่ต้องทำวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีงาน ประชุม หรือสิ่งที่ต้องทำสัปดาห์นี้" : "ไม่มีงาน ประชุม หรือสิ่งที่ต้องทำเดือนนี้";

  // Dot color now follows type (งาน/ประชุม/สิ่งที่ต้องทำ) instead of urgency —
  // asked for explicitly: "สี จุดข้างหน้าตามรูปแบบเลย งาน ประชุม สิ่งที่
  // ต้องทำ" — same colors as the calendar grid's own dots (colors.task/
  // meeting/todo). Urgency stays as a text label next to the date instead
  // of stealing the dot's color.
  function renderPersonalRow(t: Task) {
    const urgency = dueUrgency(t);
    return (
      <button
        key={t.id}
        onClick={() => onOpenTask(t.id)}
        className="w-full flex items-center gap-2.5 text-left rounded-lg -mx-1 px-1 py-1 hover:bg-[var(--bg-soft)] transition-colors"
      >
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: colors.task }} role="img" aria-label="งาน" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{t.title}</p>
          <p className="text-xs text-[var(--ink-soft)] flex items-center gap-1">
            {formatDate(t.dueDate)}
            {urgency === "overdue" && <span className="text-[var(--chart-red)] font-medium">· เลยกำหนด</span>}
            {urgency === "soon" && <span className="text-[var(--chart-amber)] font-medium">· ใกล้ถึงกำหนด</span>}
          </p>
        </div>
      </button>
    );
  }

  // Same filled-dot look as the calendar grid's own to-do dots now (see
  // full-calendar-view.tsx) — a solid amber circle always, checkmark drawn
  // on top once done, rather than a hollow checkbox that read as "no marker"
  // next to the task rows' solid dots above it in the same merged list.
  function renderTodoRow(t: TodoItem) {
    return (
      <div key={t.id} className="w-full flex items-center gap-2.5 rounded-lg -mx-1 px-1 py-1 hover:bg-[var(--bg-soft)] transition-colors">
        <button
          onClick={() => onToggleTodo(t.id)}
          aria-label={t.done ? "ทำเครื่องหมายว่ายังไม่เสร็จ" : "ทำเครื่องหมายว่าเสร็จแล้ว"}
          className="flex h-2 w-2 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.todo }}
        >
          {t.done && <Check className="h-1.5 w-1.5 text-white" strokeWidth={4} />}
        </button>
        <button onClick={() => onEditTodo(t)} className="min-w-0 flex-1 text-left">
          <p className={cn("text-sm font-medium truncate", t.done && "line-through text-[var(--ink-soft)]")}>{t.title}</p>
          <p className="text-xs text-[var(--ink-soft)]">
            {formatDate(t.date)}
            {t.time && ` · ${t.time}`}
          </p>
        </button>
      </div>
    );
  }

  function renderMeetingRow(m: CalendarEvent) {
    const attendees = (m.attendeeIds ?? []).map(getUser).filter(Boolean);
    const dept = !attendees.length && m.departmentId ? getDepartment(m.departmentId) : undefined;
    return (
      <div key={m.id} className="flex items-start gap-2.5 rounded-lg -mx-1 px-1 py-1">
        <span className="h-2 w-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: colors.meeting }} role="img" aria-label="ประชุม" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium truncate" title={m.title}>{m.title}</span>
            <span className="text-xs text-[var(--ink-soft)] shrink-0 whitespace-nowrap">
              {m.allDay ? formatDate(m.start) : formatDateTime(m.start).replace(":", ".")}
            </span>
          </div>
          {(attendees.length > 0 || dept) && (
            <div className="flex items-center gap-1.5 mt-1">
              {attendees.length > 0 ? (
                <div className="flex items-center -space-x-1.5">
                  {attendees.slice(0, 4).map((a) => (
                    <Avatar key={a!.id} className="h-5 w-5 ring-2 ring-white" title={a!.name}>
                      <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{a!.avatar}</AvatarFallback>
                    </Avatar>
                  ))}
                  {attendees.length > 4 && (
                    <span className="h-5 w-5 rounded-full ring-2 ring-white bg-[var(--bg-soft)] text-[8px] text-[var(--ink-soft)] flex items-center justify-center">
                      +{attendees.length - 4}
                    </span>
                  )}
                </div>
              ) : dept ? (
                <Badge variant="secondary" className="text-[10px] font-normal">{dept.name}</Badge>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Dot color follows type now (งาน/สิ่งที่ต้องทำ), same scheme as the
  // personal card above — was priority-colored, which no longer matches
  // once to-dos (which have no priority) sit in the same list.
  function renderCrowdRow(t: Task) {
    const assignee = t.assigneeIds[0] ? getUser(t.assigneeIds[0]) : undefined;
    return (
      <button
        key={t.id}
        onClick={() => onOpenTask(t.id)}
        className="w-full flex items-center gap-2.5 text-left rounded-lg -mx-1 px-1 py-1 hover:bg-[var(--bg-soft)] transition-colors"
      >
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: colors.task }} role="img" aria-label="งาน" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{t.title}</p>
          <p className="text-xs text-[var(--ink-soft)]">{formatDate(t.dueDate)}</p>
        </div>
        {assignee && (
          <Avatar className="h-6 w-6 shrink-0">
            <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{assignee.avatar}</AvatarFallback>
          </Avatar>
        )}
      </button>
    );
  }

  function renderCrowdTodoRow(t: TodoItem) {
    const owner = getUser(t.userId);
    return (
      <div key={t.id} className="w-full flex items-center gap-2.5 rounded-lg -mx-1 px-1 py-1">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: colors.todo }} role="img" aria-label="สิ่งที่ต้องทำ" />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium truncate", t.done && "line-through text-[var(--ink-soft)]")}>{t.title}</p>
          <p className="text-xs text-[var(--ink-soft)]">
            {formatDate(t.date)}
            {t.time && ` · ${t.time}`}
          </p>
        </div>
        {owner && (
          <Avatar className="h-6 w-6 shrink-0" title={owner.name}>
            <AvatarFallback className="text-[9px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{owner.avatar}</AvatarFallback>
          </Avatar>
        )}
      </div>
    );
  }

  // Merged, date-sorted crowd list — งาน + สิ่งที่ต้องทำของคนอื่น all read as
  // one "everything this month" list now (asked for explicitly: "รวมกันเลย"),
  // instead of the card only ever showing tasks.
  type CrowdItem = { date: string } & ({ kind: "task"; task: Task } | { kind: "todo"; todo: TodoItem });
  const crowdItems: CrowdItem[] = [
    ...monthTasks.map((t): CrowdItem => ({ kind: "task", date: t.dueDate, task: t })),
    ...otherTodos.map((t): CrowdItem => ({ kind: "todo", date: t.date, todo: t })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      {/* งานที่ฉันได้รับ — งาน/ประชุม/สิ่งที่ต้องทำ all merged into one
          date-sorted list now (asked for explicitly: "เอารวมกันเลยเป็นงานที่
          ฉันได้รับ"), always first right after the calendar grid, for
          everyone regardless of scope. */}
      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> {myHeading}
              {myItems.length > 0 && (
                <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                  {myItems.length} รายการ
                </span>
              )}
            </span>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={onAddTodo}>
              <Plus className="h-3.5 w-3.5" /> เพิ่ม
            </Button>
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)}</p>
        </CardHeader>
        <CardContent className="space-y-2.5 max-h-80 overflow-y-auto">
          {myItems.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyMyTasksLabel}</p>}
          {myItems.map((item) =>
            item.kind === "task" ? renderPersonalRow(item.task) : item.kind === "todo" ? renderTodoRow(item.todo) : renderMeetingRow(item.meeting)
          )}
        </CardContent>
      </Card>

      {/* งานทั้งหมด — a head/owner's crowd view, only when they've actually
          broadened scope to "all". Moved to last (was first) so it never
          leads over the personal card above; for anyone without a
          broadened-scope toggle at all it stays hidden entirely, same as
          before, since it'd just duplicate the personal card's own data. */}
      {canBroadenScope && taskScope === "all" && (
      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
            <span>{`งานทั้งหมด${period}`}</span>
            {crowdItems.length > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {crowdItems.length} รายการ
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)}</p>
        </CardHeader>
        <CardContent className="space-y-2.5 max-h-64 overflow-y-auto">
          {crowdItems.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyTasksLabel}</p>}
          {crowdItems.map((item) => (item.kind === "task" ? renderCrowdRow(item.task) : renderCrowdTodoRow(item.todo)))}
        </CardContent>
      </Card>
      )}
    </>
  );
}
