"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import thLocale from "@fullcalendar/core/locales/th";
import { th as thDateFns } from "date-fns/locale";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput, DayCellMountArg } from "@fullcalendar/core";
import { Button } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Calendar } from "@/modules/report_task/components/ui/calendar";
import { ChevronLeft, ChevronRight, ChevronDown, CalendarDays, MousePointerClick, PartyPopper, CalendarOff } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";
import { useLeaveTypeStore } from "@/modules/report_task/store/leave-type-store";
import { leaveIconOf } from "@/modules/report_task/lib/leave-icons";
import type { CalendarEvent, CalendarEventType } from "@/modules/report_task/types";
import { useEventColorStore } from "@/modules/report_task/store/event-color-store";
import { now, todayIso, localDateStr } from "@/modules/report_task/lib/now";

export type ViewKey = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth";

const viewOptions: { key: ViewKey; label: string }[] = [
  { key: "dayGridMonth", label: "เดือน" },
  { key: "timeGridWeek", label: "สัปดาห์" },
  { key: "timeGridDay", label: "วัน" },
  { key: "listMonth", label: "กำหนดการ" },
];

// Thai text + Gregorian year (2026 not 2569), matching the rest of the app.
const thGregorianLocale = { ...thLocale, code: "th-u-ca-gregory" };
// Holiday data spans 2026–2036, so bound the month picker to that range.
const PICKER_START = new Date(2026, 0, 1);
const PICKER_END = new Date(2036, 11, 31);

const INITIAL_DATE = now();
const initialTitle = INITIAL_DATE.toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" });

export function FullCalendarView({
  events,
  onSelectEvent,
  onViewDateChange,
  onRangeChange,
  onActiveRangeChange,
  onDateClick,
  onEventDrop,
  onSelectRange,
  onCreate,
  addHint = "คลิกวันเพื่อเพิ่มรายการ",
}: {
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent, anchorRect: DOMRect) => void;
  onViewDateChange?: (date: Date) => void;
  /** The exact visible range of whichever view is active (month/week/day/list) — for widgets that should track it, like the sidebars. */
  onRangeChange?: (r: { start: Date; end: Date; viewType: ViewKey }) => void;
  /** The *rendered grid* range — wider than `onRangeChange`'s exact month for
   *  a month view, since the grid still draws the leading/trailing days from
   *  adjacent months to fill out full weeks (e.g. Jun 28–30 in a July grid).
   *  Anything computed to populate cells the grid actually draws (like
   *  expanding a recurring rule) needs this range, not the exact-month one —
   *  using the exact month silently drops events that land on those
   *  boundary days even though the cell is right there on screen. */
  onActiveRangeChange?: (r: { start: Date; end: Date }) => void;
  onDateClick?: (date: string) => void;
  /** Return false to snap the card back — reschedule wasn't allowed. */
  onEventDrop?: (e: { id: string; type: CalendarEventType; start: string; end: string; allDay: boolean }) => boolean | void;
  onSelectRange?: (r: { start: string; end: string }) => void;
  onCreate?: () => void;
  addHint?: string;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [view, setView] = useState<ViewKey>("dayGridMonth");
  const [title, setTitle] = useState(initialTitle);
  const [currentDate, setCurrentDate] = useState<Date>(INITIAL_DATE);
  const [pickerOpen, setPickerOpen] = useState(false);
  const colors = useEventColorStore((s) => s.colors);
  const leaveTypes = useLeaveTypeStore((s) => s.types);
  const leaveIconById = useMemo(
    () => Object.fromEntries(leaveTypes.map((t) => [t.id, t.icon])) as Record<string, string>,
    [leaveTypes]
  );

  // Keyboard shortcuts (Notion/Google style): C create · T today · ←/→ navigate
  // · 1/2/3/4 switch views. Ignored while typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const api = calendarRef.current?.getApi();
      switch (e.key.toLowerCase()) {
        case "t": preserveScroll(() => api?.today()); break;
        case "arrowleft": preserveScroll(() => api?.prev()); break;
        case "arrowright": preserveScroll(() => api?.next()); break;
        case "1": changeView("dayGridMonth"); break;
        case "2": changeView("timeGridWeek"); break;
        case "3": changeView("timeGridDay"); break;
        case "4": changeView("listMonth"); break;
        case "c": e.preventDefault(); onCreate?.(); break;
        default: return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fcEvents: EventInput[] = useMemo(
    () =>
      events.map((e) => {
        const color = e.colorHint ?? colors[e.type];
        return {
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          // Pale chip in the event's own color, colored text + a left accent
          // bar. Past events use the exact same color, just faded — via the
          // .ebw-event-muted opacity rule below — instead of switching to an
          // unrelated gray, so what it was is still legible even once past.
          backgroundColor: `${color}26`,
          borderColor: color,
          textColor: color,
          // Computed per-event in calendar-view.tsx (creator/department-head
          // check) — someone else's task/meeting isn't draggable at all,
          // rather than letting the drag happen and rejecting it after drop.
          editable: !!e.editable,
          classNames: [
            ...(e.type === "holiday" ? ["ebw-event-holiday"] : []),
            ...(e.muted ? ["ebw-event-muted"] : []),
          ],
          extendedProps: { type: e.type, color, isTask: e.type === "task", muted: !!e.muted, mine: e.mine, leaveType: e.leaveType },
        };
      }),
    [events, colors]
  );

  // Read title + current month straight from the datesSet arg — reliable even on
  // first mount (the ref may not be assigned yet at that point).
  function handleDatesSet(arg: DatesSetArg) {
    setTitle(arg.view.title);
    setCurrentDate(arg.view.currentStart);
    onViewDateChange?.(arg.view.currentStart);
    onRangeChange?.({ start: arg.view.currentStart, end: arg.view.currentEnd, viewType: arg.view.type as ViewKey });
    onActiveRangeChange?.({ start: arg.view.activeStart, end: arg.view.activeEnd });
  }

  // Navigating months makes the grid re-render across several async frames,
  // which bumps the page scroll to the top. Hold the reader's position by
  // re-asserting scrollY for a short window until the layout settles.
  function preserveScroll(fn: () => void) {
    if (typeof window === "undefined") return fn();
    const y = window.scrollY;
    fn();
    let frames = 12;
    const tick = () => {
      if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y });
      if (frames-- > 0) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function jumpToDate(date: Date) {
    preserveScroll(() => calendarRef.current?.getApi().gotoDate(date));
    setPickerOpen(false);
  }

  function changeView(v: ViewKey) {
    preserveScroll(() => calendarRef.current?.getApi().changeView(v));
    setView(v);
  }

  function handleEventClick(arg: EventClickArg) {
    const found = events.find((e) => e.id === arg.event.id);
    if (found) onSelectEvent(found, arg.el.getBoundingClientRect());
  }

  function handleDateClick(arg: DateClickArg) {
    onDateClick?.(arg.dateStr.slice(0, 10));
  }

  // Local (not UTC) — arg.date from FullCalendar's moreLinkClick is midnight
  // in the calendar's own timezone, so reading it back via toISOString()
  // would roll the date a day off for non-zero UTC offsets.
  function localYmd(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  /** Tags today's cell so the product tour has a stable, always-findable spot to spotlight before demoing a drag-select — everything else about a day cell's identity shifts with the calendar page/view. */
  function handleDayCellDidMount(arg: DayCellMountArg) {
    if (localDateStr(arg.date) === todayIso()) arg.el.setAttribute("data-tour", "calendar-today-cell");
  }

  function handleSelectRange(arg: DateSelectArg) {
    const start = arg.startStr.slice(0, 10);
    const end = arg.endStr.slice(0, 10); // exclusive
    const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
    // Only treat multi-day drags as a range summary; single day = create (dateClick).
    if (days > 1) onSelectRange?.({ start, end });
    arg.view.calendar.unselect();
  }

  function handleEventDrop(arg: EventDropArg) {
    // editable:false already stops most of these before they start, but a
    // false return here (e.g. a permission edge case) snaps the card back to
    // where it was instead of leaving a visual position the data doesn't
    // actually have — the drag looked like it had "stuck" until refresh.
    const ok = onEventDrop?.({
      id: arg.event.id,
      type: arg.event.extendedProps.type as CalendarEventType,
      start: arg.event.startStr,
      end: arg.event.endStr || arg.event.startStr,
      allDay: arg.event.allDay,
    });
    if (ok === false) arg.revert();
  }

  function renderEventContent(arg: EventContentArg) {
    const type = arg.event.extendedProps.type as CalendarEventType;
    const color = (arg.event.extendedProps.color as string) ?? colors[type];
    const leaveType = arg.event.extendedProps.leaveType as string | undefined;
    const mine = arg.event.extendedProps.mine as boolean | undefined;
    // Leaves/holidays show a descriptive icon; everything else (including
    // tasks) keeps a plain color dot — priority colors are spread out enough
    // (see priorityColorHex) to tell apart without an icon too. Past events
    // fade via the .ebw-event-muted CSS opacity rule (same color, just paler)
    // rather than switching color here. Filled dot = assigned to the viewer,
    // hollow = someone else's — only meaningful for a head, who now sees a
    // mix of their own and their team's items on the same calendar.
    const Icon =
      type === "holiday"
        ? PartyPopper
        : type === "dayoff"
          ? CalendarOff
          : type === "leave" && leaveType
            ? leaveIconOf(leaveIconById[leaveType])
            : null;
    return (
      <div className="flex items-center gap-1.5 px-2 py-[3px] overflow-hidden leading-tight">
        {Icon ? (
          <Icon className="h-3 w-3 shrink-0" style={{ color }} />
        ) : (
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={
              mine === false
                ? { backgroundColor: "transparent", border: `1.5px solid ${color}` }
                : { backgroundColor: color }
            }
          />
        )}
        {!arg.event.allDay && (
          <span className="text-[10px] font-semibold tabular-nums opacity-75 shrink-0" style={{ color }}>{arg.timeText.replace(":", ".")}</span>
        )}
        <span className="truncate text-[11px] font-medium" style={{ color }}>{arg.event.title}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3 pb-3 mb-3 border-b border-[var(--line)]">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => preserveScroll(() => calendarRef.current?.getApi().prev())}
            aria-label="ช่วงก่อนหน้า"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => preserveScroll(() => calendarRef.current?.getApi().next())}
            aria-label="ช่วงถัดไป"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => preserveScroll(() => calendarRef.current?.getApi().today())}>
            วันนี้
          </Button>
        </div>

        {/* Month title + a calendar icon after it to jump to any month/year */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <button className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-base font-semibold hover:bg-[var(--bg-soft)] transition-colors">
                <span>{title}</span>
                <CalendarDays className="h-4 w-4 text-[var(--ink-soft)]" />
                <ChevronDown className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
              </button>
            }
          />
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              locale={thDateFns}
              weekStartsOn={0}
              captionLayout="dropdown"
              startMonth={PICKER_START}
              endMonth={PICKER_END}
              defaultMonth={currentDate}
              selected={currentDate}
              onSelect={(d) => d && jumpToDate(d)}
            />
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-1 ml-auto bg-[var(--bg-soft)] rounded-lg p-1">
          {viewOptions.map((opt, i) => (
            <button
              key={opt.key}
              data-tour={i === 0 ? "calendar-view-month" : i === 1 ? "calendar-view-week" : undefined}
              onClick={() => changeView(opt.key)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                view === opt.key ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ebw-calendar">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          locale={thGregorianLocale}
          // Fixed height so busy vs empty months stay the same size — the page
          // height never changes on navigation, so it can't bounce the scroll.
          height={720}
          expandRows
          // Show exactly 5 or 6 rows depending on the actual month, not
          // always padded to 6 — combined with expandRows + the fixed total
          // height above, a 5-row month gets taller rows and a 6-row month
          // gets narrower ones, instead of every month eating a wasted 6th row.
          fixedWeekCount={false}
          events={fcEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          eventDrop={handleEventDrop}
          selectable
          select={handleSelectRange}
          dayCellDidMount={handleDayCellDidMount}
          editable
          eventDurationEditable={false}
          eventContent={renderEventContent}
          // Cells share one height; show as many events as fit and only surface
          // "+more" when they actually overflow the cell (not a fixed count).
          dayMaxEvents={true}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          // "+N more" opens the same day popup as clicking the date itself
          // instead of FullCalendar's own bare popover — one consistent
          // summary UI per day, not two different-looking ones.
          moreLinkClick={(arg) => onDateClick?.(localYmd(arg.date))}
          moreLinkText={(n) => `อีก ${n} รายการ`}
          firstDay={0}
          initialDate={todayIso()}
          datesSet={handleDatesSet}
        />
      </div>

      <p className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] mt-3 pt-3 border-t border-[var(--line)]">
        <MousePointerClick className="h-3.5 w-3.5" />
        {addHint} · คีย์ลัด: <kbd className="rounded border border-[var(--line)] bg-[var(--bg-soft)] px-1">C</kbd> สร้าง ·{" "}
        <kbd className="rounded border border-[var(--line)] bg-[var(--bg-soft)] px-1">T</kbd> วันนี้ ·{" "}
        <kbd className="rounded border border-[var(--line)] bg-[var(--bg-soft)] px-1">←→</kbd> เลื่อน ·{" "}
        <kbd className="rounded border border-[var(--line)] bg-[var(--bg-soft)] px-1">1–4</kbd> มุมมอง
      </p>
    </div>
  );
}
