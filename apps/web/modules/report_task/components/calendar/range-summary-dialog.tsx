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
import { getUser, canManage, canSeeTodoOf } from "@/modules/report_task/lib/directory";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarScopeStore } from "@/modules/report_task/store/calendar-scope-store";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { priorityMeta, statusMeta } from "@/modules/report_task/lib/task-meta";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { canSeeTask, canSeeTaskOnCalendar, canSeeMeetingOnCalendar } from "@/modules/report_task/lib/permissions";
import { formatDate, formatDateTime } from "@/modules/report_task/lib/format";
import { nowMs } from "@/modules/report_task/lib/now";
import { cn } from "@/modules/report_task/lib/utils";
import { Button } from "@/modules/report_task/components/ui/button";
import { Users, CalendarOff, ListChecks, ListTodo, CalendarPlus, Check, X, Trash2 } from "lucide-react";
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
  scheduleEvents,
  todoScope = "mine",
  onOpenChange,
  onOpenTask,
  onToggleTodo,
  onEditTodo,
  onRemoveTodo,
  showTodos = true,
  onSubmitLeave,
  onAddTodo,
}: {
  range: SummaryRange | null;
  /** วันหยุด · ลา ที่ปฏิทินกำลังแสดงอยู่ (กรองสิทธิ์/ประเภท/คน และลงสีมาแล้ว)
   *  — `undefined` = ผู้ใช้ติ๊ก "วันหยุด · ลา" ออก ไม่ต้องแสดงส่วนนี้ */
  scheduleEvents?: CalendarEvent[];
  /** Mirrors calendar-view.tsx's own effective todoScope — "mine" vs "all". */
  todoScope?: "mine" | "all";
  onOpenChange: (open: boolean) => void;
  onOpenTask: (id: string) => void;
  onToggleTodo?: (id: string) => void;
  /** Clicking a to-do's title (own items only) opens it for editing. */
  onEditTodo?: (t: TodoItem) => void;
  onRemoveTodo?: (id: string) => void;
  /** Mirrors calendar-view.tsx's showTodosInWork overlay switch — hides the
   *  to-do section from the work-tab summary when the user turned it off. */
  showTodos?: boolean;
  /** Opens SubmitLeaveDialog for this date — the real ลา submission that goes
   *  through the same workforce action HR's own calendar uses, distinct from
   *  onAddSchedule's local "วันหยุดประจำ" picker above. */
  onSubmitLeave?: (date: string) => void;
  /** Same idea, for the work tab's "เพิ่มสิ่งที่ต้องทำ" button — this is now
   *  the only way to add anything (task/meeting/to-do) from this dialog. */
  onAddTodo?: (date: string) => void;
}) {
  const tasks = useTaskStore((s) => s.tasks);
  const meetings = useMeetingStore((s) => s.meetings);
  const todos = useTodoStore((s) => s.todos);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
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
    const rangeMeetings = meetings
      .filter((m) => {
        if (!inRange(m.start, start, end)) return false;
        // เห็นเฉพาะผู้สร้าง/ผู้ถูกเชิญ (หัวหน้าโหมด "ทั้งหมด" เห็นภาพรวม) —
        // ประชุมเก่าที่ไม่มีเจ้าของยังโชว์ให้ทุกคนไว้ก่อน
        const unattributed = !m.attendeeIds?.length && !m.createdById;
        return unattributed || (taskScope === "all" && canBroadenScope) || canSeeMeetingOnCalendar(m, viewingAsUserId);
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    // ใบลาหลายวันต้องขึ้นทุกวันที่คาบเกี่ยว ไม่ใช่แค่วันแรก (`end` ไม่รวมวันนั้น)
    const rangeSchedule = (scheduleEvents ?? [])
      .filter((e) => {
        const s0 = e.start.slice(0, 10);
        return s0 < end && (s0 >= start || (e.end ?? "").slice(0, 10) > start);
      })
      .sort((x, y) => x.start.localeCompare(y.start));
    const rangeTodos = todos
      .filter((t) => inRange(t.date, start, end))
      .filter((t) =>
        todoScope === "mine"
          ? t.userId === viewingAsUserId
          : canSeeTodoOf(viewingAsUserId, t.userId) && !hiddenUserIds.includes(t.userId)
      )
      .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date));
    return {
      tasks: rangeTasks,
      meetings: rangeMeetings,
      schedule: rangeSchedule,
      todos: rangeTodos,
      done: rangeTasks.filter((t) => t.status === "done").length,
      overdue: rangeTasks.filter((t) => dueUrgency(t) === "overdue").length,
    };
  }, [range, tasks, meetings, scheduleEvents, todos, todoScope, hiddenUserIds, viewingAsUserId, taskScope, canBroadenScope]);

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

        <>
            {/* Task/meeting stats only — a day with only to-dos (a separate
                category, not counted here) used to show all four tiles at a
                flat 0 right above a list that clearly had items in it, which
                read as broken rather than "just none of these two kinds".
                Adding a 5th tile for to-dos when that section is showing
                keeps the header honest about everything actually listed
                below it. */}
            <div className={cn("grid grid-cols-2 gap-2", showTodos ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
              <Stat label="งานครบกำหนด" value={data.tasks.length} />
              <Stat label="เสร็จสิ้น" value={data.done} tone="good" />
              <Stat label="เลยกำหนด" value={data.overdue} tone="bad" />
              <Stat label="ประชุม" value={data.meetings.length} />
              {showTodos && <Stat label="สิ่งที่ต้องทำ" value={data.todos.length} />}
            </div>

            <div className="max-h-72 overflow-y-auto space-y-3 mt-1">
              {data.tasks.length === 0 && data.meetings.length === 0 && (!showTodos || data.todos.length === 0) && data.schedule.length === 0 && (
                <p className="text-sm text-[var(--ink-soft)] text-center py-4">{scheduleEvents ? "ไม่มีงาน/ประชุม/วันหยุดในช่วงนี้" : "ไม่มีงาน/ประชุมในช่วงนี้"}</p>
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

              {showTodos && data.todos.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-[var(--ink-soft)] px-2 flex items-center gap-1">
                    <ListTodo className="h-3 w-3" /> สิ่งที่ต้องทำ ({data.todos.length})
                  </p>
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
              )}

              {data.schedule.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-[var(--ink-soft)] px-2 flex items-center gap-1">
                    <CalendarOff className="h-3 w-3" /> วันหยุด · ลา ({data.schedule.length})
                  </p>
                  {data.schedule.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                      style={{ borderLeft: `3px solid ${e.colorHint ?? "var(--line)"}`, backgroundColor: e.colorHint ? `${e.colorHint}14` : undefined }}
                    >
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      <span className="text-[11px] text-[var(--ink-soft)] shrink-0 whitespace-nowrap">{formatDate(e.start)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </>

        {isSingleDay && (onAddTodo || onSubmitLeave) && (
          <div className="flex flex-wrap gap-2">
            {onAddTodo && (
              <Button variant="outline" className="flex-1" onClick={() => onAddTodo(range.start)}>
                <CalendarPlus className="h-4 w-4" /> เพิ่มสิ่งที่ต้องทำ / สร้างประชุม
              </Button>
            )}
            {scheduleEvents && onSubmitLeave && (
              <Button variant="outline" className="flex-1" onClick={() => onSubmitLeave(range.start)}>
                <CalendarPlus className="h-4 w-4" /> ยื่นวันลา
              </Button>
            )}
          </div>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)] pt-1">
          <ListChecks className="h-3 w-3" />
          ลากคลุมหลายวันบนปฏิทินเพื่อดูสรุปช่วงเวลา
        </p>
      </DialogContent>
    </Dialog>
  );
}
