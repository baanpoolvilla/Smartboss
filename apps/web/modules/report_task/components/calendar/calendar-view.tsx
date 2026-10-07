"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useMeetingStore } from "@/modules/report_task/store/meeting-store";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useOvertimeStore } from "@/modules/report_task/store/overtime-store";
import { useLeaveTypeCatalogStore } from "@/modules/report_task/store/leave-type-catalog-store";
import { useTodoStore } from "@/modules/report_task/store/todo-store";
import { useHolidayStore, holidaySource, isSourceSelected } from "@/modules/report_task/store/holiday-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useGoogleCalendarStore } from "@/modules/report_task/store/google-calendar-store";
import { useRoutineDayOffStore } from "@/modules/report_task/store/routine-dayoff-store";
import { expandRule, quotaForDepartment, naturalOccurrenceFor } from "@/modules/report_task/lib/routine-dayoff";
import { formatDate, formatDateTimeShort } from "@/modules/report_task/lib/format";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/modules/report_task/components/ui/sheet";
import { Switch } from "@/modules/report_task/components/ui/switch";
import { filterFieldTriggerClass } from "@/modules/report_task/components/shared/filter-field";
import { FullCalendarView, type ViewKey, type FullCalendarViewHandle } from "./full-calendar-view";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { PeopleCalendarList } from "./people-calendar-list";
import { LeaveSidebar } from "./leave-sidebar";
import { WorkSidebar } from "./work-sidebar";
import { EventDetailDialog } from "./event-detail-dialog";
import { AddCalendarDialog } from "./add-calendar-dialog";
import { AddTodoDialog } from "./add-todo-dialog";
import { EventPreviewCard } from "./event-preview-card";
import { RangeSummaryDialog, type SummaryRange } from "./range-summary-dialog";
import { SubmitLeaveDialog } from "./submit-leave-dialog";
import { TaskDetailSheet } from "@/modules/report_task/components/kanban/task-detail-sheet";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { useCalendarScopeStore } from "@/modules/report_task/store/calendar-scope-store";
import { canEditRecord, canSeeTask, canSeeTaskOnCalendar, canSeeMeetingOnCalendar } from "@/modules/report_task/lib/permissions";
import { getUser, canManage, isOwner, scopedUsers } from "@/modules/report_task/lib/directory";
import { eventTypeLabels } from "@/modules/report_task/lib/calendar-colors";
import { typeHex } from "@/lib/leave-type-hue";
import { cn } from "@/modules/report_task/lib/utils";
import { Bell, CalendarOff, ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Settings2, User, Users, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { now } from "@/modules/report_task/lib/now";
import type { CalendarEvent, CalendarEventType, TodoItem } from "@/modules/report_task/types";

/** จำว่าติ๊ก "วันหยุด · ลา" ไว้หรือไม่ — ต่อเครื่อง */
const SHOW_SCHEDULE_KEY = "pm-calendar-show-schedule";
const RAIL_OPEN_KEY = "pm-calendar-rail-open";

/** กลุ่มประเภทของวันหยุด/ลา 1 กลุ่ม — หนึ่งแถวในเมนูเลือกประเภท */
interface ScheduleGroup {
  key: string;
  label: string;
  color: string;
  count: number;
}

/** Mobile filter sheet's "วันที่" quick-jump — a navigation shortcut, not a
 * real data filter (see the `dateJump` state's own comment). */
type DateJump = "all" | "today" | "tomorrow" | "week" | "month" | "custom";
const dateJumpLabels: Record<DateJump, string> = {
  all: "ทั้งหมด",
  today: "วันนี้",
  tomorrow: "พรุ่งนี้",
  week: "สัปดาห์นี้",
  month: "เดือนนี้",
  custom: "กำหนดช่วงวันที่",
};

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

/** ช่องติ๊กของประเภทเดียว — ใช้ทั้งในเมนู ▾ (PC) และแผงตัวกรอง (มือถือ) */
function ScheduleGroupRow({ group, checked, onToggle, roomy }: { group: ScheduleGroup; checked: boolean; onToggle: () => void; roomy?: boolean }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-[var(--bg-soft)]",
        roomy ? "py-2.5" : "py-1.5",
        !checked && "text-[var(--ink-soft)]"
      )}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0" style={{ accentColor: group.color }} />
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
      <span className="min-w-0 flex-1 truncate">{group.label}</span>
      <span className="text-xs tabular-nums text-[var(--ink-soft)]">{group.count}</span>
    </label>
  );
}

/**
 * ปุ่มเดียวของ "วันหยุด · ลา": ช่องติ๊กซ้าย = เปิด/ปิดทั้งหมด · ▾ ขวา = เลือกทีละประเภท
 * จะมีกี่ประเภทปุ่มก็ยาวเท่าเดิม (เดิมเป็นชิปเรียงทีละประเภทจนแถวล้น)
 */
function ScheduleToggle({
  checked,
  onCheckedChange,
  groups,
  hiddenKeys,
  onToggleKey,
  onShowAll,
  shownCount,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  groups: ScheduleGroup[];
  hiddenKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onShowAll: () => void;
  shownCount: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-full border text-xs font-semibold transition-colors",
        checked
          ? "border-[var(--brand-green-dark)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
          : "border-[var(--line)] text-[var(--ink-soft)]"
      )}
    >
      <label data-tour="calendar-schedule-toggle" className="flex cursor-pointer items-center gap-1.5 py-1 pl-2.5 pr-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--brand-green-dark)]"
        />
        <CalendarOff className="h-3.5 w-3.5" />
        วันหยุด · ลา
      </label>
      {checked && groups.length > 0 && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-1 border-l border-[var(--brand-green-dark)]/30 py-1 pl-2 pr-2.5 hover:bg-white/50"
                aria-label="เลือกประเภทวันหยุด/ลา"
                title="เลือกประเภทวันหยุด/ลา"
              >
                <span className="rounded-full bg-[var(--brand-green-dark)] px-1.5 text-[10px] tabular-nums text-white">
                  {shownCount}/{groups.length}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
            }
          />
          <PopoverContent align="start" className="w-64 p-1.5">
            <div className="flex items-center justify-between px-2 pb-1 pt-0.5 text-[11px] text-[var(--ink-soft)]">
              <span>ประเภทวันหยุด/ลา · จำนวนในช่วงนี้</span>
              {hiddenKeys.size > 0 && (
                <button type="button" onClick={onShowAll} className="font-semibold text-[var(--brand-green-dark)] hover:underline">
                  เลือกทั้งหมด
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {groups.map((g) => (
                <ScheduleGroupRow key={g.key} group={g} checked={!hiddenKeys.has(g.key)} onToggle={() => onToggleKey(g.key)} />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

export function CalendarView() {
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);
  const meetings = useMeetingStore((s) => s.meetings);
  const updateMeeting = useMeetingStore((s) => s.updateMeeting);
  const leaves = useLeaveStore((s) => s.leaves);
  const overtime = useOvertimeStore((s) => s.overtime);
  const leaveTypeCatalog = useLeaveTypeCatalogStore((s) => s.names);
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
  const colors = useEventColorStore((s) => s.colors);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const toggleUserVisible = useCalendarVisibilityStore((s) => s.toggle);
  const hiddenGoogleOwnerIds = useCalendarVisibilityStore((s) => s.hiddenGoogleOwnerIds);
  const toggleGoogleOwner = useCalendarVisibilityStore((s) => s.toggleGoogleOwner);
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
  // ปฏิทินเดียว: งาน/ประชุม/สิ่งที่ต้องทำ + วันหยุด · ลา ซ้อนกัน (เดิมแยกเป็น 2 แท็บ)
  // ติ๊กออก = เหลือแค่งาน · เริ่มต้นติ๊กไว้ แล้วจำค่าที่เลือกไว้ต่อเครื่อง
  const [showSchedule, setShowScheduleState] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- อ่านค่าที่จำไว้หลัง mount (server ไม่มี localStorage)
      if (localStorage.getItem(SHOW_SCHEDULE_KEY) === "0") setShowScheduleState(false);
    } catch {
      // private mode / storage ถูกปิด — ใช้ค่าเริ่มต้น
    }
  }, []);
  function setShowSchedule(next: boolean) {
    setShowScheduleState(next);
    try {
      localStorage.setItem(SHOW_SCHEDULE_KEY, next ? "1" : "0");
    } catch {
      // จำไม่ได้ก็ไม่เป็นไร
    }
  }
  // แถบ "คนในองค์กร" ด้านซ้าย (≥lg) พับเก็บได้ — ปฏิทินกว้างเต็มจอแบบปฏิทินทีมของ HR
  // ตัวกรองคนยังอยู่ กดปุ่มเดิมก็กางกลับมา · จำค่าต่อเครื่อง
  const [railOpen, setRailOpenState] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- อ่านค่าที่จำไว้หลัง mount (server ไม่มี localStorage)
      if (localStorage.getItem(RAIL_OPEN_KEY) === "0") setRailOpenState(false);
    } catch {
      // private mode / storage ถูกปิด — ใช้ค่าเริ่มต้น
    }
  }, []);
  function toggleRail() {
    setRailOpenState((prev) => {
      try {
        localStorage.setItem(RAIL_OPEN_KEY, prev ? "0" : "1");
      } catch {
        // จำไม่ได้ก็ไม่เป็นไร
      }
      return !prev;
    });
  }
  // Color now encodes type only (task/meeting/สิ่งที่ต้องทำ), not priority —
  // priority filtering by chip is gone with it, replaced by the same
  // show/hide-by-type toggle every other work-tab item already has.
  const [showTasksInWork, setShowTasksInWork] = useState(true);
  const [showMeetings, setShowMeetings] = useState(true);
  // On by default — สิ่งที่ต้องทำ no longer has its own tab (merged into งาน
  // per feedback: 3 tabs read as 2 unrelated things when to-dos are really
  // just another kind of "what's on my plate today"), so this is now the
  // only place to see them at all. The switch stays (not just always-on) so
  // someone who wants a quieter งาน view can still hide the overlay.
  const [showTodosInWork, setShowTodosInWork] = useState(true);
  // "ของฉัน" vs "ทั้งหมด" — view-only, everyone can flip it (not gated to
  // heads/owners like the work tab's scope, since a to-do isn't a
  // manage-level record) so anyone can peek at the team's list. Only its OWN
  // control for someone who has no task-scope toggle at all (a regular
  // employee — canBroadenScope false); a head/owner instead drives to-dos
  // off the SAME "มุมมอง" toggle as tasks/meetings (see effectiveTodoScope)
  // — two side-by-side "ของฉัน/ทั้งหมด" pairs read as duplicates of the same
  // control, not two different things, so they collapse into one for anyone
  // who'd otherwise see both.
  const [todoScope, setTodoScope] = useState<"mine" | "all">("mine");
  const effectiveTodoScope = canBroadenScope ? taskScope : todoScope;
  // Empty = everything visible — tracking hidden keys (not active ones) means a
  // newly-added leave type shows up by default instead of needing to be
  // explicitly opted in. Key = ScheduleGroup.key.
  const [hiddenScheduleKeys, setHiddenScheduleKeys] = useState<Set<string>>(new Set());
  function toggleScheduleKey(id: string) {
    setHiddenScheduleKeys((prev) => {
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
  const [dateJump, setDateJump] = useState<DateJump>("all");
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
  // Real ลา submission (goes through workforce) — opened from a day's summary.
  const [submitLeaveDate, setSubmitLeaveDate] = useState<string | null>(null);
  // The To Do add/edit dialog — `todo` present means "editing this one",
  // absent means "creating new".
  const [todoDialogState, setTodoDialogState] = useState<{ date?: string; todo?: TodoItem } | null>(null);
  function openTodoDialog(target: { date?: string; todo?: TodoItem }) {
    setTodoDialogState(target);
  }
  const [addCalendarOpen, setAddCalendarOpen] = useState(false);
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
  // removed, so there's nothing left to route by target. Visibility is its
  // own hiddenGoogleOwnerIds flag now, not hiddenUserIds — hiding a
  // connected calendar used to also hide that person's regular
  // tasks/meetings/leave (and vice versa), which was surprising for both
  // your own calendar (toggling it off went dark on your own tasks too) and
  // a colleague's (hiding their regular items also dropped their imported
  // calendar) — two independently useful toggles, not one.
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
      if (hiddenGoogleOwnerIds.includes(g.ownerUserId)) continue;
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
  }, [googleEvents, hiddenGoogleOwnerIds, viewingAsUserId]);

  // Feeds the mobile filter button's "(N)" badge — counts how many of the
  // CURRENT tab's fields differ from their "show everything" default,
  // not every field that merely exists (an untouched tab should read as 0).
  const mobileActiveFilterCount = useMemo(
    () =>
      (dateJump !== "all" ? 1 : 0) +
      (canBroadenScope && taskScope !== "mine" ? 1 : 0) +
      (showTasksInWork ? 0 : 1) +
      (showMeetings ? 0 : 1) +
      // On by default now (see showTodosInWork's own comment) — turning it
      // *off* is the deviation from default, not on.
      (showTodosInWork ? 0 : 1) +
      // Not double-counted against taskScope above — canBroadenScope rides
      // that one instead of having its own (see effectiveTodoScope).
      (showTodosInWork && !canBroadenScope && todoScope !== "mine" ? 1 : 0) +
      (workGoogleOwnerIds.some((id) => hiddenGoogleOwnerIds.includes(id)) ? 1 : 0) +
      (showSchedule && hiddenScheduleKeys.size > 0 ? 1 : 0),
    [dateJump, canBroadenScope, taskScope, showTasksInWork, showMeetings, showTodosInWork, todoScope, workGoogleOwnerIds, hiddenGoogleOwnerIds, showSchedule, hiddenScheduleKeys]
  );

  function clearMobileFilters() {
    setDateJump("all");
    setCustomJumpDate("");
    setTaskScope("mine");
    setShowTasksInWork(true);
    setShowMeetings(true);
    setShowTodosInWork(true);
    setTodoScope("mine");
    setHiddenScheduleKeys(new Set());
  }

  // A single-day click always shows what's already on that day first (popup)
  // — a "+" button inside it is the way to actually add something — instead
  // of jumping straight into a create dialog and hiding whatever's already
  // there. Same on both tabs now.
  function handleDateClick(date: string) {
    setSummaryRange({ start: date, end: nextDayIso(date) });
  }

  function openSubmitLeaveFromSummary(date: string) {
    setSummaryRange(null);
    setSubmitLeaveDate(date);
  }

  function handleToggleTodo(eventId: string) {
    toggleTodo(eventId.replace("todoevt-", ""));
  }

  // One legend chip per person who has a connected calendar feeding this
  // tab — its own toggle (hiddenGoogleOwnerIds), independent from that
  // person's regular tasks/meetings/leave visibility. See
  // calendar-visibility-store's own comment on hiddenGoogleOwnerIds for why.
  function googleOwnerChip(ownerId: string) {
    const hidden = hiddenGoogleOwnerIds.includes(ownerId);
    const label = getUser(ownerId)?.name ?? "ปฏิทินภายนอก";
    return (
      <button key={ownerId} onClick={() => toggleGoogleOwner(ownerId)} title={hidden ? "คลิกเพื่อแสดง" : "คลิกเพื่อซ่อน"}>
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

  // Task deadlines derived live from the store (reschedule → moves on calendar).
  // Completed tasks drop off the calendar — they're done until reopened. Color
  // is the flat "task" type color for every priority now — priority filtering
  // moved to the plain show/hide toggle (showTasksInWork) instead of a
  // per-priority chip row.
  const taskEvents: CalendarEvent[] = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.status !== "done" &&
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
          colorHint: colors.task,
          mine: t.assigneeIds.includes(viewingAsUserId),
          editable: isOwner(viewingAsUserId), // ลากเลื่อนกำหนดส่งได้เฉพาะ CEO
        })),
    [tasks, hiddenUserIds, viewingAsUserId, taskScope, canBroadenScope, colors.task]
  );

  // ประชุมเห็นเฉพาะผู้สร้าง + ผู้ถูกเชิญ (เหมือน canSeeTaskOnCalendar ของงาน)
  // — หัวหน้า/owner ที่สลับ "มุมมอง" เป็น "ทั้งหมด" ถึงจะเห็นภาพรวมทุกประชุม
  // (เท่ากับ canBroadenScope ของงาน) ประชุมเก่าที่ไม่มีทั้งผู้สร้างและผู้ถูก
  // เชิญ (seed ก่อนมีฟิลด์ createdById) โยงกับใครไม่ได้ ยังโชว์ให้ทุกคนไว้ก่อน
  // จะได้ไม่หายไปเฉย ๆ. ที่เหลือยังเคารพ toggle ซ่อนปฏิทินรายคนในโหมดเห็นหลายคน
  const visibleMeetings = useMemo(
    () =>
      meetings.filter((m) => {
        const unattributed = !m.attendeeIds?.length && !m.createdById;
        const canView =
          unattributed ||
          (taskScope === "all" && canBroadenScope) ||
          canSeeMeetingOnCalendar(m, viewingAsUserId);
        if (!canView) return false;
        return !m.attendeeIds?.length || m.attendeeIds.some((id) => !hiddenUserIds.includes(id));
      }),
    [meetings, hiddenUserIds, viewingAsUserId, taskScope, canBroadenScope]
  );
  // ใครเห็นวันหยุด/ลาของใคร: เจ้าของบริษัทเห็นทุกคน · หัวหน้าเห็นคนในแผนกที่ดูแล
  // (scopedUsers) · คนทั่วไปเห็นแค่ของตัวเอง — `null` = ไม่จำกัด
  const scheduleSeeAll = canManage(viewingAsUserId);
  const scheduleUserScope = useMemo<Set<string> | null>(() => {
    if (isOwner(viewingAsUserId)) return null;
    return new Set([viewingAsUserId, ...scopedUsers(viewingAsUserId).map((u) => u.id)]);
  }, [viewingAsUserId]);
  const canSeeScheduleOf = (userId: string | undefined) =>
    !userId || ((!scheduleUserScope || scheduleUserScope.has(userId)) && !hiddenUserIds.includes(userId));
  const visibleLeaves = useMemo(
    () => leaves.filter((l) => !l.userId || ((!scheduleUserScope || scheduleUserScope.has(l.userId)) && !hiddenUserIds.includes(l.userId))),
    [leaves, hiddenUserIds, scheduleUserScope]
  );
  const visibleOvertime = useMemo(
    () => overtime.filter((o) => !o.userId || ((!scheduleUserScope || scheduleUserScope.has(o.userId)) && !hiddenUserIds.includes(o.userId))),
    [overtime, hiddenUserIds, scheduleUserScope]
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
      if (!canSeeScheduleOf(userId)) continue;
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
      if (!canSeeScheduleOf(rule.userId)) continue;
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
    // canSeeScheduleOf อ่านแค่ scheduleUserScope + hiddenUserIds ที่อยู่ใน deps แล้ว
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routinePickedDates, routineRules, routineRuleExceptions, hiddenUserIds, scheduleUserScope, activeRange, viewingAsUserId, todayYmd]);

  // Each to-do renders as a checkable chip on its own date. "all" scope
  // prefixes someone else's item with their first name so it's still clear
  // whose it is once the list isn't just the viewer's own anymore.
  const todoEvents: CalendarEvent[] = useMemo(
    () =>
      todos
        .filter((t) => (effectiveTodoScope === "mine" ? t.userId === viewingAsUserId : !hiddenUserIds.includes(t.userId)))
        .map((t) => {
          const mine = t.userId === viewingAsUserId;
          const owner = !mine && effectiveTodoScope === "all" ? getUser(t.userId)?.name.split(" ")[0] : undefined;
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
    [todos, effectiveTodoScope, hiddenUserIds, viewingAsUserId]
  );

  // วันหยุด · ลา ทุกชนิด ลงสีตามประเภทแบบเดียวกับปฏิทินทีม (/hr) — ยังไม่กรองตามประเภท
  // ที่ติ๊กออก (ตัวนับในเมนูเลือกประเภทต้องเห็นครบ)
  const scheduleEvents = useMemo(() => {
    const groupOf = (e: CalendarEvent): { key: string; label: string; color: string } => {
      if (e.type === "holiday") return { key: "holiday", label: eventTypeLabels.holiday, color: colors.holiday };
      if (e.type === "ot") return { key: "ot", label: eventTypeLabels.ot, color: colors.ot };
      // วันหยุดประจำที่เลือกเองในโมดูลนี้ (routine-dayoff-store) ไม่ใช่ใบจาก HR
      if (e.type === "dayoff" && e.id.startsWith("dayoff-")) return { key: "routine", label: "วันหยุดประจำ", color: colors.dayoff };
      const name = e.typeName ?? e.leaveType ?? (e.type === "dayoff" ? "Day-Off" : "ลา");
      return { key: `wf:${name}`, label: name, color: typeHex(name, e.type === "dayoff") };
    };
    // Whose day off it is goes in the chip itself ("กตาวุฒิ - ลาป่วย") — unless
    // the person named it themselves ("Bee-Off", `authoredTitle`), which
    // already carries the name: prefixing would read "Bee - Bee-Off".
    const withOwner = (e: CalendarEvent) => {
      const owner = e.userId ? getUser(e.userId)?.name.split(" ")[0] : undefined;
      return owner && !e.authoredTitle ? `${owner} - ${e.title}` : e.title;
    };
    return [...visibleLeaves, ...visibleOvertime, ...holidays, ...dayoffEvents].map((e) => {
      const g = groupOf(e);
      const own = e.id.startsWith("dayoff-");
      return {
        event: {
          ...e,
          // วันหยุดประจำของโมดูลนี้ใส่ชื่อคนมาใน title แล้ว
          title: own ? e.title : withOwner(e),
          colorHint: g.color,
          mine: e.userId === viewingAsUserId,
          // ลา/OT จาก HR ลากย้ายไม่ได้ — ต้องไปทำที่ /hr (ดู handleEventDrop)
          editable: own ? e.editable : false,
        } satisfies CalendarEvent,
        group: g,
      };
    });
  }, [visibleLeaves, visibleOvertime, holidays, dayoffEvents, colors.holiday, colors.ot, colors.dayoff, viewingAsUserId]);

  // หนึ่งแถวต่อประเภทในเมนู ▾ — ประเภทที่มีในเดือนนี้ก่อน (มากไปน้อย) แล้วตามด้วย
  // ประเภทลาที่ HR ตั้งไว้แต่เดือนนี้ไม่มีใครใช้ (ให้กรองไว้ล่วงหน้าได้)
  const scheduleGroups = useMemo<ScheduleGroup[]>(() => {
    const startYmd = viewRange.start.toLocaleDateString("en-CA");
    const endYmd = viewRange.end.toLocaleDateString("en-CA");
    const byKey = new Map<string, ScheduleGroup>();
    for (const { event, group } of scheduleEvents) {
      const s0 = event.start.slice(0, 10);
      const inView = s0 < endYmd && (s0 >= startYmd || (event.end ?? "").slice(0, 10) > startYmd);
      const cur = byKey.get(group.key) ?? { ...group, count: 0 };
      if (inView) cur.count += 1;
      byKey.set(group.key, cur);
    }
    for (const name of leaveTypeCatalog) {
      const key = `wf:${name}`;
      if (!byKey.has(key)) byKey.set(key, { key, label: name, color: typeHex(name, false), count: 0 });
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
  }, [scheduleEvents, leaveTypeCatalog, viewRange]);
  const shownGroupCount = scheduleGroups.filter((g) => !hiddenScheduleKeys.has(g.key)).length;

  const visibleScheduleEvents = useMemo(
    () => scheduleEvents.filter(({ group }) => !hiddenScheduleKeys.has(group.key)).map(({ event }) => event),
    [scheduleEvents, hiddenScheduleKeys]
  );

  const events = useMemo(() => {
    // Past events just fade — same category color, paler, not a different
    // gray. Keeps the "already happened" cue without losing what it was.
    const gray = (e: CalendarEvent): CalendarEvent =>
      isPastEvent(e, nowTs, todayYmd) ? { ...e, muted: true } : e;
    const markMeeting = (m: CalendarEvent): CalendarEvent => ({
      ...m,
      mine: (m.attendeeIds ?? []).includes(viewingAsUserId) || m.createdById === viewingAsUserId,
      // No recorded creator (meetings seeded before this field existed)
      // used to mean "anyone can edit" — that left every seed meeting wide
      // open. Falls through to canEditRecord's department-head check
      // instead, same as a meeting that does have a creator.
      editable: canEditRecord(m.createdById, m.departmentIds ?? [m.departmentId], viewingAsUserId),
    });
    return [
      ...(showTasksInWork ? taskEvents : []),
      ...(showMeetings ? visibleMeetings.map(markMeeting) : []),
      ...workGoogleEvents,
      ...(showTodosInWork ? todoEvents : []),
      ...(showSchedule ? visibleScheduleEvents : []),
    ].map(gray);
  }, [
    taskEvents,
    showTasksInWork,
    showMeetings,
    showTodosInWork,
    showSchedule,
    visibleScheduleEvents,
    visibleMeetings,
    todoEvents,
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
      // เลื่อนกำหนดส่งเองได้เฉพาะ CEO — คนอื่นกด "ขอเลื่อนกำหนดส่ง" ในหน้างาน
      if (target && !isOwner(viewingAsUserId)) {
        toast.error(`เลื่อนกำหนดส่งเองได้เฉพาะ CEO — เปิดงาน "${target.title}" แล้วกด "ขอเลื่อนกำหนดส่ง"`);
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
      // ลากเลื่อนบนปฏิทิน — แจ้งผู้เข้าร่วมว่าเวลาเปลี่ยน
      if (target) {
        useNotificationStore
          .getState()
          .notifyMany(
            target.attendeeIds ?? [],
            viewingAsUserId,
            `${getUser(viewingAsUserId)?.name ?? "ผู้จัด"} เลื่อนประชุม "${target.title}" เป็น ${formatDateTimeShort(start)}`,
            target.id,
            "/report-task/calendar"
          );
      }
      toast.success("เลื่อนประชุมแล้ว");
    } else if (type === "leave") {
      // `editable: false` already stops the drag from starting — re-checked
      // here as defense-in-depth, same as every other branch. Moving a leave
      // has to go through /hr so it keeps its approval trail and stays in
      // step with the numbers payroll is computed from.
      toast.error("ย้ายวันลาที่โมดูลบุคคล (/hr แท็บปฏิทินทีม) — ที่นี่แสดงผลอย่างเดียว");
      return false;
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
    // ระยะห่างระหว่างแถบกรอง / แถบรายชื่อ / ปฏิทิน แคบลง (เดิม 16–24px) — ให้ปฏิทินกินพื้นที่จอมากที่สุด
    // ("แสดงให้เต็ม...จะได้มองวันหยุดง่าย ๆ")
    <div className="flex flex-col gap-2 lg:gap-2.5">
      <StickyFilterBar>
        {/* ≥640px: unchanged, one wrapping row (tabs + add-calendar + create).
            <640px gets its own 2-row layout below instead — tabs alone here
            already ran 3 buttons wide, plus 2 more action buttons, so on a
            phone it wrapped across 3 separate lines instead of reading as a
            single header. */}
        <div className="hidden sm:flex lg:hidden flex-wrap items-center gap-2">
          {/* "คนในองค์กร" no longer needs its own desktop button — it's the
              always-visible CalendarRail on the left now (≥lg). Still opened
              from here on <lg (rail hidden, no room for it yet), which is why
              this stays instead of dropping the shortcut entirely. */}
          <Button
            variant="outline"
            size="sm"
            className={cn("ml-auto lg:hidden text-[var(--ink-soft)]", hiddenUserIds.length > 0 && "border-[var(--brand-green-dark)] text-[var(--brand-green-dark)]")}
            onClick={() => setAddCalendarOpen(true)}
          >
            <Users className="h-3.5 w-3.5" /> คนในองค์กร
          </Button>
          {/* งาน no longer has a separate "สร้างประชุม" button — "เพิ่มสิ่งที่
              ต้องทำ" is the one create entry point, with a "เป็นการประชุม"
              switch inside open to everyone, not just managers (see
              AddTodoDialog) — a small team nudging their own meeting onto
              the calendar shouldn't have to wait on a head/owner just to
              type a title and pick attendees.
              "เพิ่มวันลา" (the schedule tab's own create button) is gone —
              ลา/Day-Off are read straight from HR now (workforce-calendar.ts),
              so submitting one has to happen at /hr, which has the approval
              chain and leave-balance ledger this module never had. This
              calendar is display-only for วันหยุด-ลา going forward
              ("หน้าของเราจะไม่ได้ให้ลงแล้ว จะให้ลงใน HR"). */}
          <Button
            size="lg"
            className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white lg:ml-auto"
            onClick={() => openTodoDialog({})}
          >
            <Plus className="h-4 w-4" />
            เพิ่มสิ่งที่ต้องทำ
          </Button>
        </div>

        {/* <640px: tabs on their own row, filter + create below — cramming
            all 4 into one row (tried first) left everything touching edge
            to edge with the create button clipped on real phone widths.
            Still 2 rows like the original, just without the "เพิ่มปฏิทิน"
            globe button (desktop-only now) so there's room to breathe. */}
        <div className="flex sm:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setAddCalendarOpen(true)}
            className={cn(filterFieldTriggerClass(hiddenUserIds.length > 0), "!h-10 !w-10 !px-0 justify-center shrink-0")}
            aria-label="คนในองค์กร"
            title="คนในองค์กร"
          >
            <Users className="h-4 w-4 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setMobileSheetOpen(true)}
            className={cn(filterFieldTriggerClass(mobileActiveFilterCount > 0), "!h-10")}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            กรอง
            {mobileActiveFilterCount > 0 && <span className="tabular-nums">({mobileActiveFilterCount})</span>}
          </button>

          {/* ติ๊กวันหยุดอยู่นอกแผงตัวกรอง — ใช้บ่อยสุด กดทีเดียวจบ ส่วนเลือกทีละประเภทอยู่ในแผง */}
          <label
            className={cn(
              filterFieldTriggerClass(showSchedule),
              "!h-10 shrink-0 cursor-pointer gap-1.5"
            )}
          >
            <input
              type="checkbox"
              checked={showSchedule}
              onChange={(e) => setShowSchedule(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand-green-dark)]"
            />
            วันหยุด
          </label>

          {/* min-w-0 + truncate: the row above already has a fixed-width
              icon button and a "กรอง (N)" pill ahead of this one — Button's
              own `whitespace-nowrap` means its label can't wrap, so on the
              narrowest phones (~360-400px) the full "เพิ่มสิ่งที่ต้องทำ" text
              forced this row past the viewport width, which then dragged the
              whole header (and the calendar grid sizing off of it) into a
              horizontal scroll instead of actually shrinking. Truncating
              with an ellipsis here keeps the row — and everything measured
              against it — inside the real viewport at any width.
              "เพิ่มวันลา" removed here too, same reason as the desktop button
              above — ลา/Day-Off entry moved to /hr. */}
          <Button
            className="ml-auto min-w-0 bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
            onClick={() => openTodoDialog({})}
            aria-label="เพิ่มสิ่งที่ต้องทำ"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="truncate">เพิ่ม</span>
          </Button>
        </div>

        {/* ≥640px: unchanged. <640px gets a button + bottom sheet below
            instead — this row's badges (a scope toggle + task/meeting/todo
            type toggles + N Google-owner chips on the work tab alone) never
            fit one line on a phone and just wrapped across 2-3 rows. */}
        <div className="hidden sm:block">
          <div className="flex flex-wrap items-center gap-2">
            {/* Whichever scope toggle applies goes first, same slot either
                way — a head/owner gets the task-scope one (broader: every
                task type), everyone else gets the todo-scope one instead
                (see effectiveTodoScope's own comment on why a regular user
                never sees both at once). Used to only exist for
                canBroadenScope up here, with the todo one bolted on at the
                very end of the row instead — same control, same meaning,
                but landing on opposite sides of the toolbar depending on
                who's looking ("ของฉัน/ทั้งหมด ของ user ไปอยู่ขวา แต่ owner
                ไปอยู่ซ้าย"). Same position for both now. */}
            {canBroadenScope ? (
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
            ) : (
              showTodosInWork && (
                <>
                  <span className="text-xs text-[var(--ink-soft)]">มุมมองสิ่งที่ต้องทำ:</span>
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
                  <span className="h-4 w-px bg-[var(--line)] mx-1" />
                </>
              )
            )}
            <span className="text-xs text-[var(--ink-soft)] mr-0.5">แสดง:</span>
            <button onClick={() => setShowTasksInWork((v) => !v)} title={showTasksInWork ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง"}>
              <Badge
                variant="outline"
                className={cn("gap-1.5 cursor-pointer select-none transition-opacity", !showTasksInWork && "opacity-40")}
                style={{ borderColor: colors.task, color: colors.task }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.task }} />
                {eventTypeLabels.task}
              </Badge>
            </button>
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
            {/* Off by default (see showTodosInWork's own comment) — a
                one-click way to overlay สิ่งที่ต้องทำ onto the same view as
                task deadlines + meetings, instead of only ever living in its
                own separate tab. */}
            <button onClick={() => setShowTodosInWork((v) => !v)} title={showTodosInWork ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง"}>
              <Badge
                variant="outline"
                className={cn("gap-1.5 cursor-pointer select-none transition-opacity", !showTodosInWork && "opacity-40")}
                style={{ borderColor: colors.todo, color: colors.todo }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.todo }} />
                {eventTypeLabels.todo}
              </Badge>
            </button>
            {workGoogleOwnerIds.map(googleOwnerChip)}
            <span className="h-4 w-px bg-[var(--line)] mx-1" />
            <ScheduleToggle
              checked={showSchedule}
              onCheckedChange={setShowSchedule}
              groups={scheduleGroups}
              hiddenKeys={hiddenScheduleKeys}
              onToggleKey={toggleScheduleKey}
              onShowAll={() => setHiddenScheduleKeys(new Set())}
              shownCount={shownGroupCount}
            />
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
            {/* Shortcut into the existing งาน/ประชุม/รีพอต/สิ่งที่ต้องทำ
                reminder-lead-time settings — asked for explicitly from
                *here*, on the calendar page, rather than only being
                reachable by already knowing it lives under Settings ▸
                แจ้งเตือน. Same panel, just a second door into it. */}
            {isOwner(viewingAsUserId) && (
              <Link
                href="/report-task/settings?tab=reminders&section=deadlineReminders"
                className="flex items-center gap-1 text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)] rounded-md px-1.5 py-0.5 hover:bg-[var(--bg-soft)] transition-colors"
                title="ตั้งค่าการแจ้งเตือนล่วงหน้า — งาน/ประชุม/รีพอต/สิ่งที่ต้องทำ"
              >
                <Bell className="h-3 w-3" /> แจ้งเตือน
              </Link>
            )}
            {/* ≥lg: ปุ่มพับแถบคนในองค์กร + ปุ่มเพิ่ม อยู่แถวเดียวกับตัวกรอง (แถวบนแยกของปุ่มเพิ่ม
                ซ่อนที่ lg แล้ว) — แถบเครื่องมือเหลือแถวเดียว ปฏิทินได้ความสูงคืนมา แบบหน้า HR */}
            <div className="ml-auto hidden lg:flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn("text-[var(--ink-soft)]", hiddenUserIds.length > 0 && "border-[var(--brand-green-dark)] text-[var(--brand-green-dark)]")}
                onClick={toggleRail}
                title={railOpen ? "พับแถบคนในองค์กร ให้ปฏิทินกว้างเต็มจอ" : "แสดงแถบคนในองค์กร"}
              >
                {railOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
                คนในองค์กร
                {!railOpen && hiddenUserIds.length > 0 && <span className="tabular-nums">(ซ่อน {hiddenUserIds.length})</span>}
              </Button>
              <Button
                size="sm"
                className="bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white"
                onClick={() => openTodoDialog({})}
              >
                <Plus className="h-4 w-4" />
                เพิ่มสิ่งที่ต้องทำ
              </Button>
            </div>
          </div>
        </div>


        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
            <SheetHeader className="flex-row items-center justify-between gap-2 pb-2 pr-11">
              <SheetTitle>ตัวกรอง</SheetTitle>
              {mobileActiveFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearMobileFilters}
                  className="text-sm font-medium text-[var(--brand-green-dark)] underline-offset-2 hover:underline"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </SheetHeader>

            <div className="flex flex-col gap-4 px-4">
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
                    <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">แสดงในปฏิทิน</p>
                    <div className="flex flex-col rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
                      <label className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <span className="flex items-center gap-2 text-sm">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colors.task }} />
                          {eventTypeLabels.task}
                        </span>
                        <Switch checked={showTasksInWork} onCheckedChange={setShowTasksInWork} />
                      </label>
                      <label className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <span className="flex items-center gap-2 text-sm">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colors.meeting }} />
                          {eventTypeLabels.meeting}
                        </span>
                        <Switch checked={showMeetings} onCheckedChange={setShowMeetings} />
                      </label>
                      <label className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <span className="flex items-center gap-2 text-sm">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colors.todo }} />
                          {eventTypeLabels.todo}
                        </span>
                        <Switch checked={showTodosInWork} onCheckedChange={setShowTodosInWork} />
                      </label>
                      {workGoogleOwnerIds.map((ownerId) => {
                        const hidden = hiddenGoogleOwnerIds.includes(ownerId);
                        const label = getUser(ownerId)?.name ?? "ปฏิทินภายนอก";
                        return (
                          <label key={ownerId} className="flex items-center justify-between gap-2 px-3 py-2.5">
                            <span className="flex items-center gap-2 text-sm">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colors.google }} />
                              {label} ({eventTypeLabels.google})
                            </span>
                            <Switch checked={!hidden} onCheckedChange={() => toggleGoogleOwner(ownerId)} />
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Only its own toggle when there's no task-scope "มุมมอง"
                      already above to share with (see effectiveTodoScope's
                      comment) — a head/owner drives both from that one
                      instead of a confusing second "ของฉัน/ทั้งหมด" pair. */}
                  {showTodosInWork && !canBroadenScope && (
                    <div>
                      <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">มุมมองสิ่งที่ต้องทำ</p>
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
              </>

              <div>
                <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">วันหยุด · ลา</p>
                <div className="flex flex-col rounded-xl border border-[var(--line)]">
                  <label className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="flex items-center gap-2 text-sm">
                      <CalendarOff className="h-4 w-4 text-[var(--ink-soft)]" />
                      แสดงวันหยุด · ลาบนปฏิทิน
                    </span>
                    <Switch checked={showSchedule} onCheckedChange={setShowSchedule} />
                  </label>
                  {showSchedule && scheduleGroups.length > 0 && (
                    <div className="border-t border-[var(--line)] px-1 py-1">
                      <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[var(--ink-soft)]">
                        <span>เลือกประเภท ({shownGroupCount}/{scheduleGroups.length})</span>
                        {hiddenScheduleKeys.size > 0 && (
                          <button type="button" onClick={() => setHiddenScheduleKeys(new Set())} className="font-semibold text-[var(--brand-green-dark)]">
                            เลือกทั้งหมด
                          </button>
                        )}
                      </div>
                      {scheduleGroups.map((g) => (
                        <ScheduleGroupRow key={g.key} group={g} checked={!hiddenScheduleKeys.has(g.key)} onToggle={() => toggleScheduleKey(g.key)} roomy />
                      ))}
                    </div>
                  )}
                </div>
              </div>

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

      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
          <FullCalendarView
            ref={fullCalendarRef}
            events={events}
            onSelectEvent={handleSelect}
            onRangeChange={setViewRange}
            onActiveRangeChange={setActiveRange}
            onDateClick={handleDateClick}
            onEventDrop={handleEventDrop}
            onSelectRange={setSummaryRange}
            onCreate={() => openTodoDialog({})}
            onToggleTodo={handleToggleTodo}
            onEditTodo={(eventId) => {
              const todoId = eventId.replace("todoevt-", "");
              const target = todos.find((t) => t.id === todoId);
              if (target) openTodoDialog({ todo: target, date: target.date });
            }}
            addHint="คลิกวันเพื่อดูรายการ · ลากคลุมหลายวันเพื่อดูสรุป"
            rail={railOpen ? <PeopleCalendarList singleColumn alwaysExpanded /> : undefined}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {/* TodoSidebar (everyone else's to-dos, its own card) used to
                render here too — now redundant since WorkSidebar's
                "งานทั้งหมดเดือนนี้" card already folds otherTodos in. */}
            <WorkSidebar
              range={viewRange}
              onOpenTask={setOpenTaskId}
              onToggleTodo={toggleTodo}
              onEditTodo={(t) => openTodoDialog({ todo: t, date: t.date })}
              onAddTodo={() => openTodoDialog({})}
              scheduleEvents={showSchedule ? visibleScheduleEvents : undefined}
              scheduleSeeAll={scheduleSeeAll}
            />
            {/* โควตา/ยื่นลา/วันหยุดประจำของตัวเอง — มากับช่องติ๊กเดียวกัน */}
            {showSchedule && <LeaveSidebar range={viewRange} holidays={holidays} personalOnly />}
          </div>
        </div>
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
      <AddCalendarDialog open={addCalendarOpen} onOpenChange={setAddCalendarOpen} />
      <RangeSummaryDialog
        range={summaryRange}
        scheduleEvents={showSchedule ? visibleScheduleEvents : undefined}
        todoScope={effectiveTodoScope}
        onOpenChange={(open) => !open && setSummaryRange(null)}
        onOpenTask={setOpenTaskId}
        onToggleTodo={toggleTodo}
        onEditTodo={(t) => { setSummaryRange(null); openTodoDialog({ todo: t, date: t.date }); }}
        onRemoveTodo={removeTodo}
        showTodos={showTodosInWork}
        onSubmitLeave={openSubmitLeaveFromSummary}
        onAddTodo={(date) => { setSummaryRange(null); openTodoDialog({ date }); }}
      />
      <TaskDetailSheet taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
      <AddTodoDialog
        open={!!todoDialogState}
        onOpenChange={(open) => !open && setTodoDialogState(null)}
        defaultDate={todoDialogState?.date}
        editingTodo={todoDialogState?.todo ?? null}
      />
      <SubmitLeaveDialog
        open={submitLeaveDate !== null}
        onOpenChange={(open) => !open && setSubmitLeaveDate(null)}
        defaultDate={submitLeaveDate ?? undefined}
      />
    </div>
  );
}
