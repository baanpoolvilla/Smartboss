"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { getUser, getDepartment } from "@/modules/report_task/lib/directory";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
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
import { User } from "lucide-react";
import type { Task } from "@/modules/report_task/types";

/** Right rail for the work calendar: the visible range's tasks (by due date) + meetings. */
export function WorkSidebar({ range, onOpenTask }: { range: ViewRange; onOpenTask: (id: string) => void }) {
  const tasks = useTaskStore((s) => s.tasks);
  const meetings = useMeetingStore((s) => s.meetings);
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

  // Both directions now that the calendar itself is scoped to canSeeTaskOnCalendar
  // (assignee OR assigner) — a task this viewer handed to someone else is just as
  // much "theirs" here as one handed to them, so this card covers both instead of
  // only the assignee half.
  const myTasks = monthTasks.filter(
    (t) => t.assigneeIds.includes(viewingAsUserId) || t.assignedById === viewingAsUserId
  );

  // Whether the top card is currently showing the same personal set as the
  // (conditionally rendered) bottom card — true for everyone without a scope
  // toggle at all, and for a head/owner who's toggled to "mine". Drives both
  // the heading text and which row style renders: same data should look the
  // same everywhere it appears, rather than the top card always using the
  // "mixed crowd" priority-dot style even when it's actually just showing
  // this one viewer's own tasks.
  const isPersonalView = !canBroadenScope || taskScope === "mine";

  // Only a head/owner can actually change scope — for them, spell out which
  // one this card currently is so it's obvious why it matches (scope "mine")
  // or differs from (scope "all") the personal card below, instead of the two
  // cards silently showing the same list with no explanation.
  const period = range.viewType === "timeGridDay" ? "วันนี้" : range.viewType === "timeGridWeek" ? "สัปดาห์นี้" : "เดือนนี้";
  const meetingHeading = range.viewType === "timeGridDay" ? "ประชุมวันนี้" : range.viewType === "timeGridWeek" ? "ประชุมสัปดาห์นี้" : "ประชุมในเดือนนี้";
  const myHeading = range.viewType === "timeGridDay" ? "งานที่ฉันรับ/มอบหมายวันนี้" : range.viewType === "timeGridWeek" ? "งานที่ฉันรับ/มอบหมายสัปดาห์นี้" : "งานที่ฉันรับ/มอบหมายเดือนนี้";
  // Same underlying data deserves the exact same heading text, not just the
  // same row style — reuse myHeading verbatim instead of a different phrasing
  // ("งานของฉันเดือนนี้") that happened to mean the same thing.
  const heading = isPersonalView ? myHeading : `งานทั้งหมด${period}`;
  const emptyTasksLabel = range.viewType === "timeGridDay" ? "ไม่มีงานครบกำหนดวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีงานครบกำหนดสัปดาห์นี้" : "ไม่มีงานครบกำหนดในเดือนนี้";
  const emptyMeetingsLabel = range.viewType === "timeGridDay" ? "ไม่มีประชุมวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีประชุมสัปดาห์นี้" : "ไม่มีประชุมในเดือนนี้";
  const emptyMyTasksLabel = range.viewType === "timeGridDay" ? "ไม่มีงานที่ฉันรับ/มอบหมายวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีงานที่ฉันรับ/มอบหมายสัปดาห์นี้" : "ไม่มีงานที่ฉันรับ/มอบหมายเดือนนี้";

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
      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              {isPersonalView && <User className="h-3.5 w-3.5 text-[var(--ink-soft)]" />} {heading}
            </span>
            {monthTasks.length > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {monthTasks.length} งาน
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">
            {rangeLabel(range)}
            {isPersonalView && " · จุดสี = ความเร่งด่วนของกำหนดส่ง (แดง = เลยกำหนด, เหลือง = ใกล้ถึงกำหนด)"}
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5 max-h-80 overflow-y-auto">
          {monthTasks.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyTasksLabel}</p>}
          {monthTasks.map((t) => (isPersonalView ? renderPersonalRow(t) : renderCrowdRow(t)))}
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

      {/* Only ever differs from the card above when scope is "all" — a head/owner
          looking at everyone's tasks needs a way to pick their own out of the
          crowd. In "mine" scope (or for anyone without a scope toggle at all)
          this would just be a pixel-for-pixel duplicate of the top card, so
          it stays hidden instead of showing the same list twice. */}
      {canBroadenScope && taskScope === "all" && (
      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> {myHeading}
            </span>
            {myTasks.length > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {myTasks.length} งาน
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">
            {rangeLabel(range)} · จุดสี = ความเร่งด่วนของกำหนดส่ง (แดง = เลยกำหนด, เหลือง = ใกล้ถึงกำหนด)
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5 max-h-64 overflow-y-auto">
          {myTasks.length === 0 && <p className="text-sm text-[var(--ink-soft)]">{emptyMyTasksLabel}</p>}
          {myTasks.map((t) => renderPersonalRow(t))}
        </CardContent>
      </Card>
      )}
    </>
  );
}
