"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/modules/report_task/components/ui/dialog";
import { getUser, canManage } from "@/modules/report_task/lib/directory";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useHolidayStore } from "@/modules/report_task/store/holiday-store";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useLeaveTypeStore } from "@/modules/report_task/store/leave-type-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarScopeStore } from "@/modules/report_task/store/calendar-scope-store";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { priorityMeta, statusMeta } from "@/modules/report_task/lib/task-meta";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { canSeeTask, canSeeTaskOnCalendar } from "@/modules/report_task/lib/permissions";
import { formatDate, formatDateTime } from "@/modules/report_task/lib/format";
import { nowMs } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import { Button } from "@/modules/report_task/components/ui/button";
import { Users, CalendarDays, Plane, PartyPopper, CalendarOff, ListChecks, ListTodo, CalendarPlus, Check, X, Trash2 } from "lucide-react";
import type { CalendarEvent, TodoItem } from "@/modules/report_task/types";

export type SummaryRange = { start: string; end: string }; // end exclusive (YYYY-MM-DD)

const inRange = (dateStr: string, start: string, endExclusive: string) => {
  const d = dateStr.slice(0, 10);
  return d >= start && d < endExclusive;
};

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "bad" }) {
  const c = { neutral: "text-[var(--ink)]", good: "text-[var(--chart-green)]", bad: "text-[var(--chart-red)]" }[tone];
  return (
    <div className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-center">
      <p className={cn("text-xl font-semibold tabular-nums", c)}>{value}</p>
      <p className="text-[11px] text-[var(--ink-soft)]">{label}</p>
    </div>
  );
}

export function RangeSummaryDialog({
  range,
  tab,
  dayoffs = [],
  todoScope = "mine",
  onOpenChange,
  onOpenTask,
  onToggleTodo,
  onEditTodo,
  onRemoveTodo,
  onAddMeeting,
  onAddSchedule,
  onAddTodo,
}: {
  range: SummaryRange | null;
  tab: "work" | "schedule" | "todo";
  /** Already-expanded routine-day-off events for the visible calendar range
   *  (see calendar-view.tsx's `dayoffEvents`) — reused here instead of
   *  re-reading the store and re-running `expandRule`, since any range this
   *  dialog can show is always a subset of what's currently on screen. */
  dayoffs?: CalendarEvent[];
  /** Mirrors calendar-view.tsx's own todoScope toggle — "mine" vs "all". */
  todoScope?: "mine" | "all";
  onOpenChange: (open: boolean) => void;
  onOpenTask: (id: string) => void;
  onToggleTodo?: (id: string) => void;
  /** Clicking a to-do's title (own items only) opens it for editing. */
  onEditTodo?: (t: TodoItem) => void;
  onRemoveTodo?: (id: string) => void;
  /** Single-day click only — a multi-day drag has no one date to hang a meeting on. */
  onAddMeeting?: (date: string) => void;
  /** Same idea as `onAddMeeting`, for the schedule tab's "เพิ่มวันลา/วันหยุดประจำ" button. */
  onAddSchedule?: (date: string) => void;
  /** Same idea, for the To Do tab's "เพิ่ม To Do" button. */
  onAddTodo?: (date: string) => void;
}) {
  const tasks = useTaskStore((s) => s.tasks);
  const meetings = useMeetingStore((s) => s.meetings);
  const leaves = useLeaveStore((s) => s.leaves);
  const holidays = useHolidayStore((s) => s.holidays);
  const todos = useTodoStore((s) => s.todos);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const leaveTypes = useLeaveTypeStore((s) => s.types);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const taskScope = useCalendarScopeStore((s) => s.scope);
  const canBroadenScope = canManage(viewingAsUserId);
  const meetingColor = useEventColorStore((s) => s.colors.meeting);

  const data = useMemo(() => {
    if (!range) return null;
    const { start, end } = range;
    const rangeTasks = tasks
      .filter(
        (t) =>
          inRange(t.dueDate, start, end) &&
          (taskScope === "all" && canBroadenScope ? canSeeTask(t, viewingAsUserId) : canSeeTaskOnCalendar(t, viewingAsUserId))
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const rangeMeetings = meetings.filter((m) => inRange(m.start, start, end)).sort((a, b) => a.start.localeCompare(b.start));
    const rangeLeaves = leaves.filter((l) => inRange(l.start, start, end)).sort((a, b) => a.start.localeCompare(b.start));
    const rangeHolidays = holidays.filter((h) => inRange(h.start, start, end)).sort((a, b) => a.start.localeCompare(b.start));
    const rangeDayoffs = dayoffs.filter((d) => inRange(d.start, start, end)).sort((a, b) => a.start.localeCompare(b.start));
    const rangeTodos = todos
      .filter((t) => inRange(t.date, start, end))
      .filter((t) => (todoScope === "mine" ? t.userId === viewingAsUserId : !hiddenUserIds.includes(t.userId)))
      .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date));
    return {
      tasks: rangeTasks,
      meetings: rangeMeetings,
      leaves: rangeLeaves,
      holidays: rangeHolidays,
      dayoffs: rangeDayoffs,
      todos: rangeTodos,
      done: rangeTasks.filter((t) => t.status === "done").length,
      overdue: rangeTasks.filter((t) => dueUrgency(t) === "overdue").length,
    };
  }, [range, tasks, meetings, leaves, holidays, dayoffs, todos, todoScope, hiddenUserIds, viewingAsUserId, taskScope, canBroadenScope]);

  if (!range || !data) return null;

  // Show the inclusive last day in the title. UTC throughout, matching how
  // date-only fields are anchored (see addDays in event-detail-dialog.tsx).
  const lastDay = new Date(`${range.end}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const days = Math.round((new Date(range.end).getTime() - new Date(range.start).getTime()) / 86400000);
  const isSingleDay = days === 1;

  return (
    <Dialog open={!!range} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogClose
          render={<Button data-tour="calendar-range-summary-close" variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
        >
          <X />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>{isSingleDay ? formatDate(range.start) : "สรุปช่วงที่เลือก"}</DialogTitle>
          {!isSingleDay && (
            <DialogDescription>
              {formatDate(range.start)} – {formatDate(lastDay.toISOString())} · {days} วัน
            </DialogDescription>
          )}
        </DialogHeader>

        {tab === "work" ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="งานครบกำหนด" value={data.tasks.length} />
              <Stat label="เสร็จสิ้น" value={data.done} tone="good" />
              <Stat label="เลยกำหนด" value={data.overdue} tone="bad" />
              <Stat label="ประชุม" value={data.meetings.length} />
            </div>

            <div className="max-h-72 overflow-y-auto space-y-3 mt-1">
              {data.tasks.length === 0 && data.meetings.length === 0 && (
                <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่มีงาน/ประชุมในช่วงนี้</p>
              )}

              {data.tasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-[var(--ink-soft)] px-2 flex items-center gap-1">
                    <ListChecks className="h-3 w-3" /> งาน ({data.tasks.length})
                  </p>
                  {data.tasks.map((t) => {
                    const urgency = dueUrgency(t);
                    return (
                      <button
                        key={t.id}
                        onClick={() => { onOpenTask(t.id); onOpenChange(false); }}
                        className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-[var(--bg-soft)]"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: priorityMeta[t.priority].accentColor }}
                          role="img"
                          aria-label={`ความสำคัญ: ${priorityMeta[t.priority].label}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                        <span
                          className={cn(
                            "text-[10px] rounded px-1.5 py-0.5 shrink-0",
                            t.status === "done"
                              ? "bg-green-50 text-[var(--brand-green-dark)]"
                              : urgency === "overdue"
                                ? "bg-red-50 text-[var(--chart-red)]"
                                : "bg-[var(--bg-soft)] text-[var(--ink-soft)]"
                          )}
                        >
                          {t.status !== "done" && urgency === "overdue" ? "เลยกำหนด" : statusMeta[t.status].label}
                        </span>
                        <span className="text-[11px] text-[var(--ink-soft)] shrink-0 whitespace-nowrap">{formatDate(t.dueDate)}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {data.meetings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-[var(--ink-soft)] px-2 flex items-center gap-1">
                    <Users className="h-3 w-3" /> ประชุม ({data.meetings.length})
                  </p>
                  {data.meetings.map((m) => {
                    const isPast = new Date(m.end || m.start).getTime() < nowMs();
                    return (
                      <div
                        key={m.id}
                        className={cn("flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg", isPast && "opacity-50")}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: meetingColor }}
                          role="img"
                          aria-label="ประชุม"
                        />
                        <span className="min-w-0 flex-1 truncate">{m.title}</span>
                        {isPast && (
                          <span className="flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 shrink-0 bg-[var(--bg-soft)] text-[var(--ink-soft)]">
                            <Check className="h-2.5 w-2.5" /> ผ่านไปแล้ว
                          </span>
                        )}
                        <span className="text-[11px] text-[var(--ink-soft)] shrink-0 whitespace-nowrap">
                          {m.allDay ? formatDate(m.start) : formatDateTime(m.start).replace(":", ".")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : tab === "todo" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="ทั้งหมด" value={data.todos.length} />
              <Stat label="เสร็จแล้ว" value={data.todos.filter((t) => t.done).length} tone="good" />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1 mt-1">
              {data.todos.length === 0 && (
                <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่มีสิ่งที่ต้องทำในช่วงนี้</p>
              )}
              {data.todos.map((t) => {
                const mine = t.userId === viewingAsUserId;
                const owner = todoScope === "all" && !mine ? getUser(t.userId) : undefined;
                return (
                  <div key={t.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-soft)]">
                    <button
                      onClick={() => mine && onToggleTodo?.(t.id)}
                      disabled={!mine}
                      aria-label={t.done ? "ทำเครื่องหมายว่ายังไม่เสร็จ" : "ทำเครื่องหมายว่าเสร็จแล้ว"}
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-[var(--chart-amber)] disabled:opacity-50 disabled:cursor-default"
                      style={t.done ? { backgroundColor: "var(--chart-amber)" } : undefined}
                    >
                      {t.done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                    </button>
                    <button
                      onClick={() => mine && onEditTodo?.(t)}
                      disabled={!mine}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      <span className={cn("block truncate text-sm", t.done && "line-through text-[var(--ink-soft)]")}>
                        {owner ? `${owner.name.split(" ")[0]}: ${t.title}` : t.title}
                      </span>
                      {t.note && <span className="block truncate text-xs text-[var(--ink-soft)]">{t.note}</span>}
                    </button>
                    <span className="text-[11px] text-[var(--ink-soft)] shrink-0 whitespace-nowrap">
                      {t.time ? t.time : formatDate(t.date)}
                    </span>
                    {mine && (
                      <button
                        onClick={() => onRemoveTodo?.(t.id)}
                        title="ลบ"
                        aria-label={`ลบ "${t.title}"`}
                        className="shrink-0 text-[var(--ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--chart-red)] transition-opacity"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="วันลา" value={data.leaves.length} />
              <Stat label="วันหยุด" value={data.holidays.length} />
              <Stat label="วันหยุดประจำ" value={data.dayoffs.length} />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5 mt-1">
              {data.leaves.length === 0 && data.holidays.length === 0 && data.dayoffs.length === 0 && (
                <p className="text-sm text-[var(--ink-soft)] text-center py-4">ไม่มีวันลา/วันหยุดในช่วงนี้</p>
              )}
              {data.leaves.map((l) => {
                const user = l.userId ? getUser(l.userId) : undefined;
                const lt = leaveTypes.find((t) => t.id === l.leaveType);
                return (
                  <div key={l.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <Plane className="h-3.5 w-3.5 shrink-0" style={{ color: lt?.color ?? "var(--ink-soft)" }} />
                    <span className="min-w-0 flex-1 truncate">{user?.name} · {lt?.label ?? "ลา"}</span>
                    <span className="text-[11px] text-[var(--ink-soft)] shrink-0 whitespace-nowrap">{formatDate(l.start)}</span>
                  </div>
                );
              })}
              {data.holidays.map((h) => (
                <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <PartyPopper className="h-3.5 w-3.5 text-[var(--chart-gray)] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  <span className="text-[11px] text-[var(--ink-soft)] shrink-0 whitespace-nowrap">{formatDate(h.start)}</span>
                </div>
              ))}
              {data.dayoffs.map((d) => {
                const user = d.userId ? getUser(d.userId) : undefined;
                return (
                  <div key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <CalendarOff className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{user?.name ?? d.title}</span>
                    <span className="text-[11px] text-[var(--ink-soft)] shrink-0 whitespace-nowrap">{formatDate(d.start)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "work" && isSingleDay && onAddMeeting && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onAddMeeting(range.start)}
          >
            <CalendarPlus className="h-4 w-4" /> สร้างประชุม
          </Button>
        )}

        {tab === "schedule" && isSingleDay && onAddSchedule && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onAddSchedule(range.start)}
          >
            <CalendarPlus className="h-4 w-4" /> เพิ่มวันลา / วันหยุดประจำ
          </Button>
        )}

        {tab === "todo" && isSingleDay && onAddTodo && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onAddTodo(range.start)}
          >
            <CalendarPlus className="h-4 w-4" /> เพิ่มสิ่งที่ต้องทำ
          </Button>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)] pt-1">
          {tab === "work" ? <ListChecks className="h-3 w-3" /> : tab === "todo" ? <ListTodo className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
          ลากคลุมหลายวันบนปฏิทินเพื่อดูสรุปช่วงเวลา
        </p>
      </DialogContent>
    </Dialog>
  );
}
