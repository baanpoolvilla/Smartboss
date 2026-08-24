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
import { priorityMeta } from "@/modules/report_task/lib/task-meta";
import { formatDate, formatDateTime } from "@/modules/report_task/lib/format";
import { rangeLabel, inRange, inRangeLocal, type ViewRange } from "@/modules/report_task/lib/date-filter";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { canManage } from "@/modules/report_task/lib/directory";
import { canSeeTask, canSeeTaskOnCalendar } from "@/modules/report_task/lib/permissions";
import { cn } from "@/modules/report_task/lib/utils";
import { User, Check, Plus } from "lucide-react";
import type { Task, TodoItem } from "@/modules/report_task/types";

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

  const myTodos = todos
    .filter((t) => t.userId === viewingAsUserId && inRange(t.date, range))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date));

  // Assignee-only — was assignee-OR-assigner ("a task I handed to someone
  // else is just as much mine as one handed to me"), reversed on explicit
  // feedback: this card should read as "what's actually on my plate",
  // not include tasks the viewer created/assigned but doesn't have to do
  // themselves ("งานที่เราแอดเค้าไปไม่เอามา เอาแค่งานที่เค้าแอดเราพอแล้ว").
  const myTasks = monthTasks.filter((t) => t.assigneeIds.includes(viewingAsUserId));

  // Merged, date-sorted personal list — งานที่ฉันรับ and สิ่งที่ต้องทำ read as
  // one "what's on my plate" list now instead of two separate cards (asked
  // for explicitly: "สิ่งที่ต้องทำ จะเอาเข้ามาอยู่ด้วย ในงานที่ฉันรับ").
  type PersonalItem = { date: string } & ({ kind: "task"; task: Task } | { kind: "todo"; todo: TodoItem });
  const myItems: PersonalItem[] = [
    ...myTasks.map((t): PersonalItem => ({ kind: "task", date: t.dueDate, task: t })),
    ...myTodos.map((t): PersonalItem => ({ kind: "todo", date: t.date, todo: t })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const period = range.viewType === "timeGridDay" ? "วันนี้" : range.viewType === "timeGridWeek" ? "สัปดาห์นี้" : "เดือนนี้";
  const meetingHeading = range.viewType === "timeGridDay" ? "ประชุมวันนี้" : range.viewType === "timeGridWeek" ? "ประชุมสัปดาห์นี้" : "ประชุมในเดือนนี้";
  const myHeading = range.viewType === "timeGridDay" ? "งานที่ฉันรับวันนี้" : range.viewType === "timeGridWeek" ? "งานที่ฉันรับสัปดาห์นี้" : "งานที่ฉันรับเดือนนี้";
  const emptyTasksLabel = range.viewType === "timeGridDay" ? "ไม่มีงานครบกำหนดวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีงานครบกำหนดสัปดาห์นี้" : "ไม่มีงานครบกำหนดในเดือนนี้";
  const emptyMeetingsLabel = range.viewType === "timeGridDay" ? "ไม่มีประชุมวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีประชุมสัปดาห์นี้" : "ไม่มีประชุมในเดือนนี้";
  const emptyMyTasksLabel = range.viewType === "timeGridDay" ? "ไม่มีงานหรือสิ่งที่ต้องทำวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีงานหรือสิ่งที่ต้องทำสัปดาห์นี้" : "ไม่มีงานหรือสิ่งที่ต้องทำเดือนนี้";

  // One row style for "this is my personal task list" wherever it's shown —
  // urgency-colored dot (deadline pressure matters more than priority once
  // it's just your own short list) — and a separate one for a mixed crowd of
  // everyone's tasks, where priority + whose avatar it is reads faster.
  function renderPersonalRow(t: Task) {
    const urgency = dueUrgency(t);
    return (
      <button
        key={t.id}
        onClick={() => onOpenTask(t.id)}
        className="w-full flex items-center gap-2.5 text-left rounded-lg -mx-1 px-1 py-1 hover:bg-[var(--bg-soft)] transition-colors"
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            urgency === "overdue" ? "bg-[var(--chart-red)]" : urgency === "soon" ? "bg-[var(--chart-amber)]" : "bg-[var(--line)]"
          )}
          role="img"
          aria-label={`กำหนดส่ง: ${urgency === "overdue" ? "เลยกำหนดแล้ว" : urgency === "soon" ? "ใกล้ถึงกำหนด" : "ยังไม่ถึงกำหนด"}`}
          title={urgency === "overdue" ? "เลยกำหนดแล้ว" : urgency === "soon" ? "ใกล้ถึงกำหนด" : "ยังไม่ถึงกำหนด"}
        />
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
          style={{ backgroundColor: "var(--chart-amber)" }}
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

  function renderCrowdRow(t: Task) {
    const assignee = t.assigneeIds[0] ? getUser(t.assigneeIds[0]) : undefined;
    return (
      <button
        key={t.id}
        onClick={() => onOpenTask(t.id)}
        className="w-full flex items-center gap-2.5 text-left rounded-lg -mx-1 px-1 py-1 hover:bg-[var(--bg-soft)] transition-colors"
      >
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: priorityMeta[t.priority].accentColor }}
          role="img"
          aria-label={`ความสำคัญ: ${priorityMeta[t.priority].label}`}
        />
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

  return (
    <>
      {/* งานที่ฉันรับ — always first now, right after the calendar grid
          (asked for explicitly: "ให้ไปอยู่อันแรกแทนต่อจากปฏิทิน"), for
          everyone regardless of scope. Used to only appear here for anyone
          without a broadened-scope toggle at all, with a head/owner's own
          copy of it relegated to a 3rd card below the crowd view — swapped
          so "what's on my plate" leads every time. */}
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
          <p className="text-xs text-[var(--ink-soft)]">
            {rangeLabel(range)} · จุดสี = ความเร่งด่วนของกำหนดส่ง (แดง = เลยกำหนด, เหลือง = ใกล้ถึงกำหนด) · อำพัน = สิ่งที่ต้องทำ
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5 max-h-80 overflow-y-auto">
          {myItems.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyMyTasksLabel}</p>}
          {myItems.map((item) => (item.kind === "task" ? renderPersonalRow(item.task) : renderTodoRow(item.todo)))}
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
            {meetingHeading}
            {monthMeetings.length > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {monthMeetings.length}
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)}</p>
        </CardHeader>
        <CardContent className="space-y-3 max-h-64 overflow-y-auto">
          {monthMeetings.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyMeetingsLabel}</p>}
          {monthMeetings.map((m) => {
            const attendees = (m.attendeeIds ?? []).map(getUser).filter(Boolean);
            const dept = !attendees.length && m.departmentId ? getDepartment(m.departmentId) : undefined;
            return (
              <div key={m.id} className="text-sm space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium truncate min-w-0" title={m.title}>{m.title}</span>
                  <span className="text-xs text-[var(--ink-soft)] shrink-0 whitespace-nowrap">
                    {m.allDay ? formatDate(m.start) : formatDateTime(m.start).replace(":", ".")}
                  </span>
                </div>
                {(attendees.length > 0 || dept) && (
                  <div className="flex items-center gap-1.5">
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
            );
          })}
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
            {monthTasks.length > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {monthTasks.length} งาน
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)}</p>
        </CardHeader>
        <CardContent className="space-y-2.5 max-h-64 overflow-y-auto">
          {monthTasks.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyTasksLabel}</p>}
          {monthTasks.map((t) => renderCrowdRow(t))}
        </CardContent>
      </Card>
      )}
    </>
  );
}
