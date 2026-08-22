"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useHolidayStore, holidaySource, isSourceSelected } from "@/modules/report_task/store/holiday-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useGoogleCalendarStore } from "@/modules/report_task/store/google-calendar-store";
import { useRoutineDayOffStore } from "@/modules/report_task/store/routine-dayoff-store";
import { expandRule, quotaForDepartment, naturalOccurrenceFor } from "@/modules/report_task/lib/routine-dayoff";
import { formatDate } from "@/modules/report_task/lib/format";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/modules/report_task/components/ui/sheet";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { CalendarFilters } from "./calendar-filters";
import { FullCalendarView, type ViewKey, type FullCalendarViewHandle } from "./full-calendar-view";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { LeaveSidebar } from "./leave-sidebar";
import { WorkSidebar } from "./work-sidebar";
import { TodoSidebar } from "./todo-sidebar";
import { EventDetailDialog } from "./event-detail-dialog";
import { AddCalendarDialog } from "./add-calendar-dialog";
import { AddTodoDialog } from "./add-todo-dialog";
import { EventPreviewCard } from "./event-preview-card";
import { RangeSummaryDialog, type SummaryRange } from "./range-summary-dialog";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { NewTaskDialog } from "@/modules/report_task/components/kanban/new-task-dialog";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { useCalendarScopeStore } from "@/modules/report_task/store/calendar-scope-store";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import { canEditRecord, canSeeTask, canSeeTaskOnCalendar } from "@/modules/report_task/lib/permissions";
import { getUser, canManage, isOwner } from "@/modules/report_task/lib/directory";
import { priorityMeta, priorityColorHex, taskPriorityOrder } from "@/modules/report_task/lib/task-meta";
import { eventTypeLabels } from "@/modules/report_task/lib/calendar-colors";
import { leaveIconOf } from "@/modules/report_task/lib/leave-icons";
import { useLeaveTypeStore, type LeaveTypeDef } from "@/modules/report_task/store/leave-type-store";
import { cn } from "@/modules/report_task/lib/utils";
import { ListChecks, CalendarOff, ListTodo, Plus, Settings2, Globe, User, Users, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { now } from "@/modules/report_task/lib/now";
import type { CalendarEvent, CalendarEventType, TaskPriority, TodoItem } from "@/modules/report_task/types";

type CalendarTab = "work" | "schedule" | "todo";

// Work calendar = task deadlines (colored by priority) + meetings.
// Schedule calendar = leaves (live from store) + holidays (opted-in per
// country, see holiday-store) + routine days off.
const scheduleTypes: CalendarEventType[] = ["leave", "dayoff", "holiday"];

function monthKeysInRange(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function isPastEvent(e: CalendarEvent, nowTs: number, todayYmd: string): boolean {
  if (e.allDay) return e.start.slice(0, 10) < todayYmd;
  return new Date(e.end ?? e.start).getTime() < nowTs;
}

// UTC throughout, matching how date-only fields are anchored elsewhere
// (see shiftDate in new-task-dialog.tsx) — mixing local setDate() with a
// UTC read back rolls the result a day off for non-zero UTC offsets.
function nextDayIso(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Beyond this many leave types, the rest move into the "+N เพิ่มเติม" popover
// instead of wrapping the filter row onto extra lines.
const LEAVE_TYPE_CHIP_LIMIT = 4;

function leaveTypeChip(lt: LeaveTypeDef, hiddenIds: Set<string>, onToggle: (id: string) => void) {
  const Icon = leaveIconOf(lt.icon);
  const isActive = !hiddenIds.has(lt.id);
  return (
    <button key={lt.id} onClick={() => onToggle(lt.id)} title={isActive ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง"}>
      <Badge
        variant="outline"
        className={cn("gap-1.5 cursor-pointer select-none transition-opacity", !isActive && "opacity-40")}
        style={{ borderColor: lt.color, color: lt.color }}
      >
        <Icon className="h-3 w-3" style={{ color: lt.color }} />
        {lt.label}
      </Badge>
    </button>
  );
}

export function CalendarView() {
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);
  const meetings = useMeetingStore((s) => s.meetings);
  const updateMeeting = useMeetingStore((s) => s.updateMeeting);
  const leaves = useLeaveStore((s) => s.leaves);
  const updateLeave = useLeaveStore((s) => s.updateLeave);
  const todos = useTodoStore((s) => s.todos);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);
  const allHolidays = useHolidayStore((s) => s.holidays);
  const holidaySelections = useHolidayStore((s) => s.selectedByUser);
  const routinePickedDates = useRoutineDayOffStore((s) => s.pickedDates);
  const routineRules = useRoutineDayOffStore((s) => s.rules);
  const routineRuleExceptions = useRoutineDayOffStore((s) => s.ruleExceptions);
  const movePickedDate = useRoutineDayOffStore((s) => s.movePickedDate);
  const moveRuleOccurrence = useRoutineDayOffStore((s) => s.moveRuleOccurrence);
  const routineCompanyQuota = useRoutineDayOffStore((s) => s.companyMonthlyQuota);
  const routineUseDeptOverrides = useRoutineDayOffStore((s) => s.useDepartmentOverrides);
  const routineDeptQuotas = useRoutineDayOffStore((s) => s.departmentQuotas);
  const leaveTypes = useLeaveTypeStore((s) => s.types);
  const colors = useEventColorStore((s) => s.colors);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const toggleUserVisible = useCalendarVisibilityStore((s) => s.toggle);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const taskScope = useCalendarScopeStore((s) => s.scope);
  const setTaskScope = useCalendarScopeStore((s) => s.setScope);
  // A regular employee's "all" and "mine" are the exact same set (canSeeTask's
  // fallback case already is assignee-or-assigner) — the toggle only changes
  // anything for a head/owner, so it stays "mine" and hidden for everyone else.
  const canBroadenScope = canManage(viewingAsUserId);
  const lastScopeIdentity = useRef(viewingAsUserId);
  useEffect(() => {
    if (lastScopeIdentity.current !== viewingAsUserId) {
      lastScopeIdentity.current = viewingAsUserId;
      setTaskScope("mine");
    }
  }, [viewingAsUserId, setTaskScope]);
  // Each country (Thailand included) only shows on the calendar of whoever
  // personally selected it — see holidaySource/isSourceSelected.
  const holidays = useMemo(
    () => allHolidays.filter((h) => isSourceSelected(holidaySelections, viewingAsUserId, holidaySource(h))),
    [allHolidays, holidaySelections, viewingAsUserId]
  );
  const [tab, setTab] = useState<CalendarTab>("work");
  const [workPriorities, setWorkPriorities] = useState<Set<TaskPriority>>(new Set(taskPriorityOrder));
  const [showMeetings, setShowMeetings] = useState(true);
  const [scheduleActive, setScheduleActive] = useState<Set<CalendarEventType>>(new Set(scheduleTypes));
  // "ของฉัน" vs "ทั้งหมด" — view-only, everyone can flip it (not gated to
  // heads/owners like the work tab's scope, since a to-do isn't a
  // manage-level record) so anyone can peek at the team's list.
  const [todoScope, setTodoScope] = useState<"mine" | "all">("mine");
  // Empty = everything visible — tracking hidden ids (not active ids) means a
  // newly-added leave type shows up by default instead of needing to be
  // explicitly opted in.
  const [hiddenLeaveTypeIds, setHiddenLeaveTypeIds] = useState<Set<string>>(new Set());
  function toggleLeaveType(id: string) {
    setHiddenLeaveTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // <640px only — each tab's filter row collapses into one button that opens
  // a bottom sheet (same pattern as the Kanban board's TaskFilters), instead
  // of the row's badges wrapping across 2-3 lines on a phone.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  // "วันที่" quick-jump in the mobile sheet — a navigation shortcut (moves
  // the calendar to a date/view), not a real filter like the fields above
  // (nothing here narrows which events show). Shared across all 3 tabs since
  // it's the same calendar underneath regardless of which data tab is active.
  const [dateJump, setDateJump] = useState<"all" | "today" | "tomorrow" | "week" | "month" | "custom">("all");
  const [customJumpDate, setCustomJumpDate] = useState("");
  const fullCalendarRef = useRef<FullCalendarViewHandle>(null);
  function applyDateJump(next: typeof dateJump, customDate?: string) {
    setDateJump(next);
    const today = now();
    if (next === "today") fullCalendarRef.current?.jumpToDate(today, "timeGridDay");
    else if (next === "tomorrow") {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      fullCalendarRef.current?.jumpToDate(d, "timeGridDay");
    } else if (next === "week") fullCalendarRef.current?.jumpToDate(today, "timeGridWeek");
    else if (next === "month") fullCalendarRef.current?.jumpToDate(today, "dayGridMonth");
    else if (next === "custom" && customDate) fullCalendarRef.current?.jumpToDate(new Date(`${customDate}T00:00:00`), "timeGridDay");
  }
  // The exact visible range of whichever FullCalendar view is active, so the
  // sidebars can show "today" / "this week" / "this month" instead of always
  // defaulting to the month containing `viewDate`.
  const [viewRange, setViewRange] = useState<{ start: Date; end: Date; viewType: ViewKey }>(() => {
    const start = now();
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    return { start: monthStart, end, viewType: "dayGridMonth" };
  });
  // The wider, actually-rendered grid range (includes adjacent-month
  // boundary days a month view pads in to fill full weeks) — see
  // `onActiveRangeChange` in full-calendar-view.tsx. Only used where the
  // calculation needs to match what's literally drawn on screen; `viewRange`
  // above (exact month) stays the source of truth for "this month" sidebar
  // labels/filtering.
  const [activeRange, setActiveRange] = useState<{ start: Date; end: Date }>(viewRange);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [previewEvent, setPreviewEvent] = useState<{ event: CalendarEvent; rect: DOMRect } | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  // The To Do add/edit dialog has its own tiny state, separate from
  // createOpen/createDate above (those still drive NewTaskDialog for
  // meetings/leaves) — `todo` present means "editing this one", absent
  // means "creating new".
  const [todoDialogState, setTodoDialogState] = useState<{ date?: string; todo?: TodoItem } | null>(null);
  function openTodoDialog(target: { date?: string; todo?: TodoItem }) {
    setTodoDialogState(target);
  }
  const [addCalendarOpen, setAddCalendarOpen] = useState(false);
  const [addCalendarSection, setAddCalendarSection] = useState<"recommended" | "people">("recommended");
  const [summaryRange, setSummaryRange] = useState<SummaryRange | null>(null);
  // Real "now" for fading past events — computed once on mount (the calendar is
  // client-only, so this stays stable and needs no server value).
  const [nowTs] = useState(() => Date.now());
  const todayYmd = new Date(nowTs).toLocaleDateString("en-CA");

  const googleEvents = useGoogleCalendarStore((s) => s.events);
  const setGoogleEvents = useGoogleCalendarStore((s) => s.setEvents);
  const setGoogleSyncing = useGoogleCalendarStore((s) => s.setSyncing);
  // Bumped by the Add Calendar dialog on connect/disconnect/re-target/re-share
  // — included below so that kind of change resyncs immediately instead of
  // waiting for the next scheduled poll.
  const googleResyncNonce = useGoogleCalendarStore((s) => s.resyncNonce);

  // Every connected calendar (anyone's) feeds the same shared events, like
  // native leave records — so this polls unconditionally rather than gating
  // on whether the *current viewer* happens to have connected anything.
  useEffect(() => {
    let cancelled = false;
    async function sync() {
      setGoogleSyncing(true);
      try {
        const params = new URLSearchParams({
          timeMin: viewRange.start.toISOString(),
          timeMax: viewRange.end.toISOString(),
          viewerId: viewingAsUserId,
        });
        const res = await fetch(`/api/report-task/google-calendar/events?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) return;
        setGoogleEvents(data.events ?? []);
      } catch {
        // Transient network hiccup — next poll tries again, no need to surface it.
      } finally {
        if (!cancelled) setGoogleSyncing(false);
      }
    }
    sync();
    const interval = setInterval(sync, 3 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewRange.start, viewRange.end, googleResyncNonce, viewingAsUserId, setGoogleEvents, setGoogleSyncing]);

  // Connected external calendars only ever feed the work tab now — syncing
  // one into วันลา/วันหยุด (auto-detecting routine days off from it) was
  // removed, so there's nothing left to route by target. Same "who's shown"
  // list as tasks/meetings/leaves governs visibility here too, since a
  // connected calendar is just another thing that person owns.
  const { workGoogleEvents, workGoogleOwnerIds } = useMemo(() => {
    const work: CalendarEvent[] = [];
    const workOwners = new Set<string>();
    for (const g of googleEvents) {
      // Private calendars only ever reach their own owner — everyone else's
      // browser gets the same event data back from the API (no per-viewer
      // auth on this endpoint, same as the rest of the app), so the actual
      // gate has to happen here.
      if (!g.shared && g.ownerUserId !== viewingAsUserId) continue;
      workOwners.add(g.ownerUserId);
      if (hiddenUserIds.includes(g.ownerUserId)) continue;
      work.push({
        id: g.id,
        title: g.title,
        type: "google" as const,
        start: g.start,
        end: g.end,
        allDay: g.allDay,
        userId: g.ownerUserId,
        editable: false,
        mine: g.ownerUserId === viewingAsUserId,
        description: g.sourceLabel,
      });
    }
    return { workGoogleEvents: work, workGoogleOwnerIds: Array.from(workOwners) };
  }, [googleEvents, hiddenUserIds, viewingAsUserId]);

  // Feeds the mobile filter button's "(N)" badge — counts how many of the
  // CURRENT tab's fields differ from their "show everything" default,
  // not every field that merely exists (an untouched tab should read as 0).
  const mobileActiveFilterCount = useMemo(() => {
    const dateJumpCount = dateJump !== "all" ? 1 : 0;
    if (tab === "work") {
      return (
        dateJumpCount +
        (canBroadenScope && taskScope !== "mine" ? 1 : 0) +
        (workPriorities.size !== taskPriorityOrder.length ? 1 : 0) +
        (showMeetings ? 0 : 1) +
        (workGoogleOwnerIds.some((id) => hiddenUserIds.includes(id)) ? 1 : 0)
      );
    }
    if (tab === "todo") return dateJumpCount + (todoScope !== "mine" ? 1 : 0);
    return (
      dateJumpCount +
      (scheduleActive.size !== scheduleTypes.length ? 1 : 0) +
      (hiddenLeaveTypeIds.size > 0 ? 1 : 0)
    );
  }, [tab, dateJump, canBroadenScope, taskScope, workPriorities, showMeetings, workGoogleOwnerIds, hiddenUserIds, todoScope, scheduleActive, hiddenLeaveTypeIds]);

  function openCreate(date?: string) {
    setCreateDate(date);
    setCreateOpen(true);
  }

  // A single-day click always shows what's already on that day first (popup)
  // — a "+" button inside it is the way to actually add something — instead
  // of jumping straight into a create dialog and hiding whatever's already
  // there. Same on both tabs now.
  function handleDateClick(date: string) {
    setSummaryRange({ start: date, end: nextDayIso(date) });
  }

  function openAddFromSummary(date: string) {
    setSummaryRange(null);
    openCreate(date);
  }

  function handleToggleTodo(eventId: string) {
    toggleTodo(eventId.replace("todoevt-", ""));
  }

  function togglePriority(p: TaskPriority) {
    setWorkPriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function toggleSchedule(type: CalendarEventType) {
    setScheduleActive((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }


  // One legend chip per person who has a connected calendar feeding this
  // tab — clicking it reuses the same "who's shown" toggle as everything
  // else (tasks/meetings/leaves), so there's a single show/hide switch per
  // person instead of a separate one just for their external calendar.
  function googleOwnerChip(ownerId: string) {
    const hidden = hiddenUserIds.includes(ownerId);
    const label = getUser(ownerId)?.name ?? "ปฏิทินภายนอก";
    return (
      <button key={ownerId} onClick={() => toggleUserVisible(ownerId)} title={hidden ? "คลิกเพื่อแสดง" : "คลิกเพื่อซ่อน"}>
        <Badge
          variant="outline"
          className={cn("gap-1.5 cursor-pointer select-none transition-opacity", hidden && "opacity-40")}
          style={{ borderColor: colors.google, color: colors.google }}
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.google }} />
          {label} ({eventTypeLabels.google})
        </Badge>
      </button>
    );
  }

  // Task deadlines derived live from the store (reschedule → moves on calendar),
  // filtered by the selected priorities and colored by priority. Completed tasks
  // drop off the calendar — they're done until reopened.
  const taskEvents: CalendarEvent[] = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.status !== "done" &&
            workPriorities.has(t.priority) &&
            t.assigneeIds.some((id) => !hiddenUserIds.includes(id)) &&
            (taskScope === "all" && canBroadenScope
              ? canSeeTask(t, viewingAsUserId)
              : canSeeTaskOnCalendar(t, viewingAsUserId))
        )
        .map((t) => ({
          id: `taskevt-${t.id}`,
          title: t.title,
          type: "task" as const,
          start: t.dueDate.slice(0, 10),
          end: t.dueDate.slice(0, 10),
          allDay: true,
          userId: t.assigneeIds[0],
          departmentId: t.departmentIds[0],
          taskId: t.id,
          createdById: t.assignedById,
          colorHint: priorityColorHex[t.priority],
          mine: t.assigneeIds.includes(viewingAsUserId),
          editable: canEditRecord(t.assignedById, t.departmentIds, viewingAsUserId),
        })),
    [tasks, workPriorities, hiddenUserIds, viewingAsUserId, taskScope, canBroadenScope]
  );

  // A meeting with no attendee list can't be attributed to anyone in
  // particular, so it stays visible regardless of who's toggled off.
  const visibleMeetings = useMemo(
    () => meetings.filter((m) => !m.attendeeIds?.length || m.attendeeIds.some((id) => !hiddenUserIds.includes(id))),
    [meetings, hiddenUserIds]
  );
  const visibleLeaves = useMemo(
    () => leaves.filter((l) => !l.userId || !hiddenUserIds.includes(l.userId)),
    [leaves, hiddenUserIds]
  );

  // Everyone's routine days off (manual picks + expanded recurring rules,
  // team-wide, not just the viewer's own) that fall within the visible
  // range — same team-wide visibility as leaves, so the calendar grid is
  // the one place both show up together instead of routines only ever
  // living in the sidebar.
  const dayoffEvents = useMemo(() => {
    const months = monthKeysInRange(activeRange.start, activeRange.end);
    const monthSet = new Set(months);
    const items: CalendarEvent[] = [];
    for (const [userId, dates] of Object.entries(routinePickedDates)) {
      if (hiddenUserIds.includes(userId)) continue;
      const name = getUser(userId)?.name.split(" ")[0] ?? "";
      for (const date of dates) {
        if (!monthSet.has(date.slice(0, 7))) continue;
        items.push({
          id: `dayoff-${userId}-${date}`,
          title: `${name} - วันหยุดประจำ`,
          type: "dayoff",
          start: date,
          end: date,
          allDay: true,
          userId,
          mine: userId === viewingAsUserId,
          // Only your own, and only if it hasn't already happened — a past
          // day off is history, not something to reschedule.
          editable: userId === viewingAsUserId && date >= todayYmd,
        });
      }
    }
    for (const rule of routineRules) {
      if (hiddenUserIds.includes(rule.userId)) continue;
      const name = getUser(rule.userId)?.name.split(" ")[0] ?? "";
      for (const month of months) {
        for (const date of expandRule(rule, routineRuleExceptions, month)) {
          items.push({
            id: `dayoff-rule-${rule.id}-${date}`,
            title: `${name} - วันหยุดประจำ`,
            type: "dayoff",
            start: date,
            end: date,
            allDay: true,
            userId: rule.userId,
            mine: rule.userId === viewingAsUserId,
            editable: rule.userId === viewingAsUserId && date >= todayYmd,
          });
        }
      }
    }
    return items;
  }, [routinePickedDates, routineRules, routineRuleExceptions, hiddenUserIds, activeRange, viewingAsUserId, todayYmd]);

  // Each to-do renders as a checkable chip on its own date. "all" scope
  // prefixes someone else's item with their first name so it's still clear
  // whose it is once the list isn't just the viewer's own anymore.
  const todoEvents: CalendarEvent[] = useMemo(
    () =>
      todos
        .filter((t) => (todoScope === "mine" ? t.userId === viewingAsUserId : !hiddenUserIds.includes(t.userId)))
        .map((t) => {
          const mine = t.userId === viewingAsUserId;
          const owner = !mine && todoScope === "all" ? getUser(t.userId)?.name.split(" ")[0] : undefined;
          const titleWithTime = t.time ? `${t.time} ${t.title}` : t.title;
          return {
            id: `todoevt-${t.id}`,
            title: owner ? `${owner}: ${titleWithTime}` : titleWithTime,
            type: "todo" as const,
            start: t.date,
            end: t.date,
            allDay: true,
            userId: t.userId,
            mine,
            done: t.done,
            // Only your own is draggable to another day — someone else's
            // (visible in "all" scope) is read-only.
            editable: mine,
          };
        }),
    [todos, todoScope, hiddenUserIds, viewingAsUserId]
  );

  const events = useMemo(() => {
    // Past events just fade — same category color, paler, not a different
    // gray. Keeps the "already happened" cue without losing what it was.
    const gray = (e: CalendarEvent): CalendarEvent =>
      isPastEvent(e, nowTs, todayYmd) ? { ...e, muted: true } : e;
    if (tab === "work") {
      const markMeeting = (m: CalendarEvent): CalendarEvent => ({
        ...m,
        mine: (m.attendeeIds ?? []).includes(viewingAsUserId) || m.createdById === viewingAsUserId,
        // No recorded creator (meetings seeded before this field existed)
        // used to mean "anyone can edit" — that left every seed meeting wide
        // open. Falls through to canEditRecord's department-head check
        // instead, same as a meeting that does have a creator.
        editable: canEditRecord(m.createdById, m.departmentIds ?? [m.departmentId], viewingAsUserId),
      });
      return [...taskEvents, ...(showMeetings ? visibleMeetings.map(markMeeting) : []), ...workGoogleEvents].map(gray);
    }
    if (tab === "todo") {
      return todoEvents.map(gray);
    }
    // Color leaves by type (past ones still gray via `gray`).
    const leaveColorById = new Map(leaveTypes.map((t) => [t.id, t.color]));
    const coloredLeaves = visibleLeaves.map((l) => ({
      ...l,
      colorHint: (l.leaveType && leaveColorById.get(l.leaveType)) ?? chartColors.gray,
      mine: l.userId === viewingAsUserId,
      editable: canEditRecord(l.userId, [getUser(l.userId ?? "")?.departmentId], viewingAsUserId),
    }));
    return [...coloredLeaves, ...holidays, ...dayoffEvents]
      .filter((e) => scheduleActive.has(e.type))
      .filter((e) => e.type !== "leave" || !e.leaveType || !hiddenLeaveTypeIds.has(e.leaveType))
      .map(gray);
  }, [
    tab,
    taskEvents,
    showMeetings,
    scheduleActive,
    hiddenLeaveTypeIds,
    visibleMeetings,
    visibleLeaves,
    holidays,
    dayoffEvents,
    todoEvents,
    leaveTypes,
    nowTs,
    todayYmd,
    viewingAsUserId,
    workGoogleEvents,
  ]);

  // A click first shows a quick-look preview (Google-Calendar-style) rather
  // than jumping straight to the full task sheet / event dialog every time.
  function handleSelect(event: CalendarEvent, anchorRect: DOMRect) {
    setPreviewEvent({ event, rect: anchorRect });
  }

  function openFullEvent(event: CalendarEvent) {
    setPreviewEvent(null);
    if (event.type === "task" && event.taskId) {
      setOpenTaskId(event.taskId);
    } else {
      setSelectedEvent(event);
    }
  }

  // All of a user's own routine-day-off dates in `month` — manual picks plus
  // every rule's expanded occurrences — same "effective set" the sidebar
  // uses for its own quota/swap math (see leave-sidebar.tsx), needed here
  // too so a drag-drop can validate against the same rules.
  function effectiveDayoffDatesForMonth(userId: string, month: string): string[] {
    const manual = (routinePickedDates[userId] ?? []).filter((d) => d.slice(0, 7) === month);
    const fromRules = routineRules
      .filter((r) => r.userId === userId)
      .flatMap((r) => expandRule(r, routineRuleExceptions, month));
    return [...manual, ...fromRules];
  }

  // A dragged dayoff event's id doesn't carry enough to know cleanly whether
  // it's a plain pick or a rule's occurrence (both `userId` and `date`
  // contain hyphens, so parsing the id string back apart is unreliable) —
  // look it up against the actual data instead, same as the sidebar does.
  function findDayoffOrigin(userId: string, date: string): { kind: "manual" } | { kind: "rule"; ruleId: string; naturalDate: string } | null {
    if ((routinePickedDates[userId] ?? []).includes(date)) return { kind: "manual" };
    for (const rule of routineRules) {
      if (rule.userId !== userId) continue;
      const naturalDate = naturalOccurrenceFor(rule, routineRuleExceptions, date);
      if (naturalDate) return { kind: "rule", ruleId: rule.id, naturalDate };
    }
    return null;
  }

  // Drag an event to a new day → reschedule it in the right store (creator/owner only).
  // Returns false on rejection so the calendar snaps the card back — with
  // editable:false on the event this is now a backstop, not the first line
  // of defense, but still needed for the visual to match the data on reject.
  function handleEventDrop({ id, type, start, end, allDay }: { id: string; type: CalendarEventType; start: string; end: string; allDay: boolean }): boolean {
    // Applies to every draggable type — the past is done, nothing gets
    // rescheduled into it (a task/meeting/leave dropped on today itself is
    // still fine; only a strictly-before-today target is rejected).
    if (start.slice(0, 10) < todayYmd) {
      toast.error("ย้ายไปวันที่ผ่านมาแล้วไม่ได้");
      return false;
    }
    if (type === "task") {
      const taskId = id.replace("taskevt-", "");
      const target = tasks.find((t) => t.id === taskId);
      if (target && !canEditRecord(target.assignedById, target.departmentIds, viewingAsUserId)) {
        toast.error(`แก้ไขกำหนดส่งได้เฉพาะผู้สร้างงานหรือหัวหน้าแผนก "${target.title}"`);
        return false;
      }
      updateTask(taskId, { dueDate: new Date(start).toISOString() });
      toast.success("เลื่อนกำหนดส่งงานแล้ว");
    } else if (type === "meeting") {
      const target = meetings.find((m) => m.id === id);
      // No `target?.createdById &&` guard here on purpose — a meeting with no
      // recorded creator still has to pass canEditRecord (department head
      // only), not skip the check entirely.
      if (target && !canEditRecord(target.createdById, target.departmentIds ?? [target.departmentId], viewingAsUserId)) {
        toast.error(`เลื่อนประชุมได้เฉพาะผู้สร้างหรือหัวหน้าแผนก "${target.title}"`);
        return false;
      }
      updateMeeting(id, { start, end: end ?? start, allDay });
      toast.success("เลื่อนประชุมแล้ว");
    } else if (type === "leave") {
      const target = leaves.find((l) => l.id === id);
      if (target && !canEditRecord(target.userId, [getUser(target.userId ?? "")?.departmentId], viewingAsUserId)) {
        toast.error("แก้ไขวันลาได้เฉพาะเจ้าของหรือหัวหน้าแผนก");
        return false;
      }
      updateLeave(id, { start, end: end ?? start });
      toast.success("เลื่อนวันลาแล้ว");
    } else if (type === "todo") {
      const todoId = id.replace("todoevt-", "");
      const target = todos.find((t) => t.id === todoId);
      // editable:false (see todoEvents) already stops someone else's to-do
      // from being draggable at all — re-checked here as defense-in-depth,
      // same as every other branch.
      if (!target || target.userId !== viewingAsUserId) {
        toast.error("ย้ายสิ่งที่ต้องทำได้เฉพาะของตัวเอง");
        return false;
      }
      updateTodo(todoId, { date: start.slice(0, 10) });
      toast.success("ย้ายสิ่งที่ต้องทำแล้ว");
    } else if (type === "dayoff") {
      const target = dayoffEvents.find((e) => e.id === id);
      // Only reachable at all when `editable` was true (own + not-past), but
      // re-checked here too, same defense-in-depth as every other branch.
      if (!target || target.userId !== viewingAsUserId) {
        toast.error("ย้ายวันหยุดประจำได้เฉพาะของตัวเอง");
        return false;
      }
      const fromDate = target.start;
      const toDate = start.slice(0, 10);
      if (fromDate === toDate) return true;
      const origin = findDayoffOrigin(viewingAsUserId, fromDate);
      if (!origin) return false;
      const targetMonth = toDate.slice(0, 7);
      const targetDates = effectiveDayoffDatesForMonth(viewingAsUserId, targetMonth);
      if (targetDates.includes(toDate)) {
        toast.error("เลือกวันนี้ไว้แล้ว");
        return false;
      }
      const quota = quotaForDepartment(getUser(viewingAsUserId)?.departmentId, routineCompanyQuota, routineDeptQuotas, routineUseDeptOverrides);
      if (targetDates.filter((d) => d !== fromDate).length >= quota) {
        toast.error(`ครบโควตา ${quota} วัน/เดือนของเดือนที่ย้ายไปแล้ว`);
        return false;
      }
      if (origin.kind === "manual") movePickedDate(viewingAsUserId, fromDate, toDate);
      else moveRuleOccurrence(origin.ruleId, origin.naturalDate, toDate);
      toast.success(`ย้ายวันหยุดประจำจาก ${formatDate(fromDate)} เป็น ${formatDate(toDate)} แล้ว`);
    }
    return true;
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <StickyFilterBar>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--bg-soft)] p-1.5">
            <button
              data-tour="calendar-tab-work"
              onClick={() => setTab("work")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                tab === "work"
                  ? "bg-[var(--brand-green)] text-[var(--ink)] shadow-md"
                  : "bg-white text-[var(--ink-soft)] border border-[var(--line)] hover:text-[var(--ink)]"
              )}
            >
              <ListChecks className="h-4 w-4" />
              งาน
            </button>
            <button
              data-tour="calendar-tab-schedule"
              onClick={() => setTab("schedule")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                tab === "schedule"
                  ? "bg-[var(--brand-green)] text-[var(--ink)] shadow-md"
                  : "bg-white text-[var(--ink-soft)] border border-[var(--line)] hover:text-[var(--ink)]"
              )}
            >
              <CalendarOff className="h-4 w-4" />
              วันหยุด · ลา
            </button>
            <button
              data-tour="calendar-tab-todo"
              onClick={() => setTab("todo")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                tab === "todo"
                  ? "bg-[var(--brand-green)] text-[var(--ink)] shadow-md"
                  : "bg-white text-[var(--ink-soft)] border border-[var(--line)] hover:text-[var(--ink)]"
              )}
            >
              <ListTodo className="h-4 w-4" />
              สิ่งที่ต้องทำ
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-[var(--ink-soft)]"
            onClick={() => {
              setAddCalendarSection("recommended");
              setAddCalendarOpen(true);
            }}
          >
            <Globe className="h-3.5 w-3.5" /> เพิ่มปฏิทิน
          </Button>
          {/* Scheduling a meeting is a manage-level action (see NewTaskDialog) —
              on the work tab, hide the button entirely rather than opening a
              dialog with no allowed type left to pick. */}
          {(tab !== "work" || canManage(viewingAsUserId)) && (
            <Button
              size="lg"
              className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
              onClick={() => (tab === "todo" ? openTodoDialog({}) : openCreate())}
            >
              <Plus className="h-4 w-4" />
              {tab === "work" ? "สร้างประชุม" : tab === "todo" ? "เพิ่มสิ่งที่ต้องทำ" : "เพิ่มวันลา"}
            </Button>
          )}
        </div>

        {/* ≥640px: unchanged. <640px gets a button + bottom sheet below
            instead — this row's badges (up to 4 priority chips + a scope
            toggle + a meetings toggle + N Google-owner chips on the work
            tab alone) never fit one line on a phone and just wrapped across
            2-3 rows. */}
        <div className="hidden sm:block">
        {tab === "work" ? (
          <div className="flex flex-wrap items-center gap-2">
            {canBroadenScope && (
              <>
                <span className="text-xs text-[var(--ink-soft)]">มุมมอง:</span>
                <div className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-lg p-1">
                  <button
                    data-tour="calendar-scope-mine"
                    onClick={() => setTaskScope("mine")}
                    title="แสดงเฉพาะงานที่ฉันรับหรือมอบหมาย"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                      taskScope === "mine"
                        ? "bg-white shadow-sm text-[var(--ink)]"
                        : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-white/60"
                    )}
                  >
                    <User className="h-3.5 w-3.5" />
                    งานของฉัน
                  </button>
                  <button
                    data-tour="calendar-scope-all"
                    onClick={() => setTaskScope("all")}
                    title="แสดงงานทั้งหมดที่มีสิทธิ์เห็น (ทั้งแผนก/บริษัท)"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                      taskScope === "all"
                        ? "bg-white shadow-sm text-[var(--ink)]"
                        : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-white/60"
                    )}
                  >
                    <Users className="h-3.5 w-3.5" />
                    ทั้งหมด
                  </button>
                </div>
                <span className="h-4 w-px bg-[var(--line)] mx-1" />
              </>
            )}
            <span className="text-xs text-[var(--ink-soft)] mr-0.5">ความสำคัญ (คลิกเพื่อกรอง):</span>
            {taskPriorityOrder.map((p, i) => {
              const isActive = workPriorities.has(p);
              return (
                <button
                  key={p}
                  data-tour={i === 0 ? "calendar-priority-filter" : undefined}
                  onClick={() => togglePriority(p)}
                  title={isActive ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง"}
                  aria-label={`${priorityMeta[p].label} — ${isActive ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง"}`}
                >
                  <Badge
                    variant="outline"
                    className={cn("gap-1.5 cursor-pointer select-none transition-opacity", !isActive && "opacity-40")}
                    style={{ borderColor: priorityColorHex[p], color: priorityColorHex[p] }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: priorityColorHex[p] }} />
                    {priorityMeta[p].label}
                  </Badge>
                </button>
              );
            })}
            <span className="h-4 w-px bg-[var(--line)] mx-1" />
            <button data-tour="calendar-meetings-toggle" onClick={() => setShowMeetings((v) => !v)} title={showMeetings ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง"}>
              <Badge
                variant="outline"
                className={cn("gap-1.5 cursor-pointer select-none transition-opacity", !showMeetings && "opacity-40")}
                style={{ borderColor: colors.meeting, color: colors.meeting }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.meeting }} />
                {eventTypeLabels.meeting}
              </Badge>
            </button>
            {workGoogleOwnerIds.map(googleOwnerChip)}
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)] ml-1 opacity-60">
              <span className="h-2 w-2 rounded-full bg-[var(--chart-red)]" />
              ผ่านไปแล้ว = สีจางลง
            </span>
            {canManage(viewingAsUserId) && (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)] opacity-60">
                <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--chart-red)]" />
                จุดกลวง = งานของคนอื่น
              </span>
            )}
          </div>
        ) : tab === "todo" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--ink-soft)]">มุมมอง:</span>
            <div className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-lg p-1">
              <button
                onClick={() => setTodoScope("mine")}
                title="แสดงเฉพาะสิ่งที่ต้องทำของฉัน"
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                  todoScope === "mine"
                    ? "bg-white shadow-sm text-[var(--ink)]"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-white/60"
                )}
              >
                <User className="h-3.5 w-3.5" />
                ของฉัน
              </button>
              <button
                onClick={() => setTodoScope("all")}
                title="แสดงสิ่งที่ต้องทำของทุกคน"
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                  todoScope === "all"
                    ? "bg-white shadow-sm text-[var(--ink)]"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-white/60"
                )}
              >
                <Users className="h-3.5 w-3.5" />
                ทั้งหมด
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CalendarFilters types={scheduleTypes} active={scheduleActive} onToggle={toggleSchedule} />
            <span className="h-4 w-px bg-[var(--line)]" />
            <span className="text-xs text-[var(--ink-soft)]">ประเภทลา:</span>
            {leaveTypes.slice(0, LEAVE_TYPE_CHIP_LIMIT).map((lt) => leaveTypeChip(lt, hiddenLeaveTypeIds, toggleLeaveType))}
            {leaveTypes.length > LEAVE_TYPE_CHIP_LIMIT && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      className="flex items-center gap-1 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] rounded-full border border-[var(--line)] px-2 py-0.5 hover:bg-[var(--bg-soft)] transition-colors"
                      title="ประเภทลาเพิ่มเติม"
                    >
                      +{leaveTypes.length - LEAVE_TYPE_CHIP_LIMIT} เพิ่มเติม
                    </button>
                  }
                />
                <PopoverContent align="start" className="w-auto p-2">
                  <div className="flex flex-col gap-1.5">
                    {leaveTypes.slice(LEAVE_TYPE_CHIP_LIMIT).map((lt) => leaveTypeChip(lt, hiddenLeaveTypeIds, toggleLeaveType))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {/* Leave types + routine day-off quotas moved to /settings
                (บริษัท) — company-wide config, same place as sticker/penalty
                settings. Owner-only there now (not just any department
                head) since these apply across every department at once. */}
            {isOwner(viewingAsUserId) && (
              <Link
                href="/report-task/settings?tab=calendar"
                className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)] rounded-md px-1.5 py-0.5 hover:bg-[var(--bg-soft)] transition-colors"
                title="จัดการประเภทการลา / โควตาวันหยุดประจำ"
              >
                <Settings2 className="h-3 w-3" /> ตั้งค่า
              </Link>
            )}
          </div>
        )}
        </div>

        <div className="flex sm:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileSheetOpen(true)}
            className={cn(filterFieldTriggerClass(mobileActiveFilterCount > 0), "!h-10")}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            ตัวกรอง
            {mobileActiveFilterCount > 0 && <span className="tabular-nums">({mobileActiveFilterCount})</span>}
          </button>
        </div>

        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
            <SheetHeader className="flex-row items-center justify-between gap-2 pb-2 pr-11">
              <SheetTitle>ตัวกรอง</SheetTitle>
              {mobileActiveFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDateJump("all");
                    setCustomJumpDate("");
                    if (tab === "work") {
                      setTaskScope("mine");
                      setWorkPriorities(new Set(taskPriorityOrder));
                      setShowMeetings(true);
                    } else if (tab === "todo") {
                      setTodoScope("mine");
                    } else {
                      setScheduleActive(new Set(scheduleTypes));
                      setHiddenLeaveTypeIds(new Set());
                    }
                  }}
                  className="text-sm font-medium text-[var(--brand-green-dark)] underline-offset-2 hover:underline"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </SheetHeader>

            <div className="flex flex-col gap-4 px-4">
              {tab === "work" && (
                <>
                  {canBroadenScope && (
                    <div>
                      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">มุมมอง</p>
                      <div className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-xl p-1">
                        <button
                          onClick={() => setTaskScope("mine")}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 px-2.5 py-2.5 text-sm font-medium rounded-lg transition-colors",
                            taskScope === "mine" ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)]"
                          )}
                        >
                          <User className="h-4 w-4" /> งานของฉัน
                        </button>
                        <button
                          onClick={() => setTaskScope("all")}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 px-2.5 py-2.5 text-sm font-medium rounded-lg transition-colors",
                            taskScope === "all" ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)]"
                          )}
                        >
                          <Users className="h-4 w-4" /> ทั้งหมด
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">ความสำคัญ (แตะเพื่อกรอง)</p>
                    <div className="grid grid-cols-2 gap-2">
                      {taskPriorityOrder.map((p) => {
                        const isActive = workPriorities.has(p);
                        return (
                          <button
                            key={p}
                            onClick={() => togglePriority(p)}
                            className={cn(
                              "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium",
                              isActive ? "border-current" : "border-[var(--line)] text-[var(--ink-soft)] opacity-60"
                            )}
                            style={isActive ? { borderColor: priorityColorHex[p], color: priorityColorHex[p] } : undefined}
                          >
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: priorityColorHex[p] }} />
                            {priorityMeta[p].label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">แสดงในปฏิทิน</p>
                    <div className="flex flex-col rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
                      <label className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <span className="flex items-center gap-2 text-sm">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colors.meeting }} />
                          {eventTypeLabels.meeting}
                        </span>
                        <Switch checked={showMeetings} onCheckedChange={setShowMeetings} />
                      </label>
                      {workGoogleOwnerIds.map((ownerId) => {
                        const hidden = hiddenUserIds.includes(ownerId);
                        const label = getUser(ownerId)?.name ?? "ปฏิทินภายนอก";
                        return (
                          <label key={ownerId} className="flex items-center justify-between gap-2 px-3 py-2.5">
                            <span className="flex items-center gap-2 text-sm">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colors.google }} />
                              {label} ({eventTypeLabels.google})
                            </span>
                            <Switch checked={!hidden} onCheckedChange={() => toggleUserVisible(ownerId)} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {tab === "todo" && (
                <div>
                  <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">มุมมอง</p>
                  <div className="flex items-center gap-1 bg-[var(--bg-soft)] rounded-xl p-1">
                    <button
                      onClick={() => setTodoScope("mine")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 px-2.5 py-2.5 text-sm font-medium rounded-lg transition-colors",
                        todoScope === "mine" ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)]"
                      )}
                    >
                      <User className="h-4 w-4" /> ของฉัน
                    </button>
                    <button
                      onClick={() => setTodoScope("all")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 px-2.5 py-2.5 text-sm font-medium rounded-lg transition-colors",
                        todoScope === "all" ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)]"
                      )}
                    >
                      <Users className="h-4 w-4" /> ทั้งหมด
                    </button>
                  </div>
                </div>
              )}

              {tab === "schedule" && (
                <>
                  <div>
                    <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">ประเภท</p>
                    <div className="flex flex-col rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
                      {scheduleTypes.map((t) => {
                        const color = t === "leave" ? "var(--ink-soft)" : colors[t];
                        return (
                          <label key={t} className="flex items-center justify-between gap-2 px-3 py-2.5">
                            <span className="flex items-center gap-2 text-sm">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              {eventTypeLabels[t]}
                            </span>
                            <Switch checked={scheduleActive.has(t)} onCheckedChange={() => toggleSchedule(t)} />
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">ประเภทลา</p>
                    <div className="flex flex-col rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
                      {leaveTypes.map((lt) => {
                        const Icon = leaveIconOf(lt.icon);
                        return (
                          <label key={lt.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                            <span className="flex items-center gap-2 text-sm">
                              <Icon className="h-4 w-4" style={{ color: lt.color }} />
                              {lt.label}
                            </span>
                            <Switch checked={!hiddenLeaveTypeIds.has(lt.id)} onCheckedChange={() => toggleLeaveType(lt.id)} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Navigation shortcut, not a real filter — jumps the calendar
                  underneath to a date/view. Same for every tab since it's
                  the same calendar regardless of which data tab is active. */}
              <div>
                <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">วันที่</p>
                <div className="flex flex-col rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
                  {(
                    [
                      { key: "all", label: "ทั้งหมด" },
                      { key: "today", label: "วันนี้" },
                      { key: "tomorrow", label: "พรุ่งนี้" },
                      { key: "week", label: "สัปดาห์นี้" },
                      { key: "month", label: "เดือนนี้" },
                      { key: "custom", label: "กำหนดช่วงวันที่" },
                    ] as const
                  ).map((opt) => (
                    <label key={opt.key} className="flex items-center gap-3 px-3 py-2.5 text-sm text-[var(--ink)]">
                      <input
                        type="radio"
                        name="calendar-date-jump"
                        checked={dateJump === opt.key}
                        onChange={() => applyDateJump(opt.key, customJumpDate)}
                        className="h-4 w-4 accent-[var(--brand-green-dark)]"
                      />
                      {opt.label}
                    </label>
                  ))}
                  {dateJump === "custom" && (
                    <div className="px-3 py-2.5">
                      <DatePickerField
                        value={customJumpDate}
                        onChange={(v) => {
                          setCustomJumpDate(v);
                          applyDateJump("custom", v);
                        }}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <SheetFooter>
              <Button
                className="h-[46px] w-full bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
                onClick={() => setMobileSheetOpen(false)}
              >
                ใช้ตัวกรอง
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </StickyFilterBar>

      <FullCalendarView
        ref={fullCalendarRef}
        events={events}
        onSelectEvent={handleSelect}
        onRangeChange={setViewRange}
        onActiveRangeChange={setActiveRange}
        onDateClick={handleDateClick}
        onEventDrop={handleEventDrop}
        onSelectRange={setSummaryRange}
        onCreate={
          tab === "todo"
            ? () => openTodoDialog({})
            : tab === "work" && !canManage(viewingAsUserId)
              ? undefined
              : () => openCreate()
        }
        onToggleTodo={handleToggleTodo}
        onEditTodo={(eventId) => {
          const todoId = eventId.replace("todoevt-", "");
          const target = todos.find((t) => t.id === todoId);
          if (target) openTodoDialog({ todo: target, date: target.date });
        }}
        addHint="คลิกวันเพื่อดูรายการ · ลากคลุมหลายวันเพื่อดูสรุป"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {tab === "work" ? (
          <WorkSidebar range={viewRange} onOpenTask={setOpenTaskId} />
        ) : tab === "todo" ? (
          <TodoSidebar range={viewRange} scope={todoScope} onEdit={(t) => openTodoDialog({ todo: t, date: t.date })} />
        ) : (
          <LeaveSidebar range={viewRange} holidays={holidays} />
        )}
      </div>

      {previewEvent && (
        <EventPreviewCard
          event={previewEvent.event}
          anchorRect={previewEvent.rect}
          color={previewEvent.event.colorHint ?? colors[previewEvent.event.type]}
          onClose={() => setPreviewEvent(null)}
          onOpenFull={() => openFullEvent(previewEvent.event)}
        />
      )}
      <EventDetailDialog event={selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)} />
      <AddCalendarDialog open={addCalendarOpen} onOpenChange={setAddCalendarOpen} initialSection={addCalendarSection} />
      <RangeSummaryDialog
        range={summaryRange}
        tab={tab}
        dayoffs={dayoffEvents}
        todoScope={todoScope}
        onOpenChange={(open) => !open && setSummaryRange(null)}
        onOpenTask={setOpenTaskId}
        onToggleTodo={toggleTodo}
        onEditTodo={(t) => { setSummaryRange(null); openTodoDialog({ todo: t, date: t.date }); }}
        onRemoveTodo={removeTodo}
        onAddMeeting={canManage(viewingAsUserId) ? openAddFromSummary : undefined}
        onAddSchedule={openAddFromSummary}
        onAddTodo={(date) => { setSummaryRange(null); openTodoDialog({ date }); }}
      />
      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
      {/* Work tab only ever creates meetings here — tasks are created on the
          kanban board and just show up on this calendar already linked. To
          do's are their own much smaller dialog below, not another type
          bolted onto this one. */}
      <NewTaskDialog
        key={`${tab}-${createDate ?? "new"}`}
        open={createOpen && tab !== "todo"}
        onOpenChange={setCreateOpen}
        defaultType={tab === "schedule" ? "leave" : "meeting"}
        allowedTypes={tab === "schedule" ? ["leave", "dayoff"] : ["meeting"]}
        defaultDate={createDate}
      />
      <AddTodoDialog
        open={!!todoDialogState}
        onOpenChange={(open) => !open && setTodoDialogState(null)}
        defaultDate={todoDialogState?.date}
        editingTodo={todoDialogState?.todo ?? null}
      />
    </div>
  );
}
