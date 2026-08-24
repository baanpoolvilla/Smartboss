"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import thLocale from "@fullcalendar/core/locales/th";
import { th as thDateFns } from "date-fns/locale";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput, DayCellMountArg, DayCellContentArg } from "@fullcalendar/core";
import { Button } from "@/modules/report_task/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/modules/report_task/components/ui/popover";
import { Calendar } from "@/modules/report_task/components/ui/calendar";
import { ChevronLeft, ChevronRight, ChevronDown, CalendarDays, MousePointerClick, CalendarOff, Check } from "lucide-react";
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

/** Imperative handle so a parent (e.g. the mobile filter sheet's "วันที่"
 * quick-jump list) can navigate the calendar from outside — the view/date
 * are otherwise fully internal state with no prop to control them. */
export interface FullCalendarViewHandle {
  jumpToDate: (date: Date, view?: ViewKey) => void;
}

interface FullCalendarViewProps {
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
  /** To-do chips render their own checkbox inline instead of opening the
   *  usual click-through preview — this fires straight from the checkbox. */
  onToggleTodo?: (id: string) => void;
  /** Clicking a to-do chip's title (not its checkbox) opens it for editing. */
  onEditTodo?: (id: string) => void;
  addHint?: string;
}

export const FullCalendarView = forwardRef<FullCalendarViewHandle, FullCalendarViewProps>(function FullCalendarView({
  events,
  onSelectEvent,
  onViewDateChange,
  onRangeChange,
  onActiveRangeChange,
  onDateClick,
  onEventDrop,
  onSelectRange,
  onCreate,
  onToggleTodo,
  onEditTodo,
  addHint = "คลิกวันเพื่อเพิ่มรายการ",
}, ref) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewKey>("dayGridMonth");
  const [title, setTitle] = useState(initialTitle);
  const [currentDate, setCurrentDate] = useState<Date>(INITIAL_DATE);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Fills whatever room is actually below the calendar's own position instead
  // of a flat 720px — on a typical desktop window that flat value pushed the
  // grid's bottom rows below the fold, forcing a scroll just to see this
  // month at all. Still a *fixed* number once computed (not "auto"), for the
  // same reason as before: a 5-row vs 6-row month can't be allowed to change
  // the page's height and bounce the scroll position on navigation — this
  // just recomputes that fixed number from the real layout instead of
  // guessing one constant that never matches every screen size.
  const [calendarHeight, setCalendarHeight] = useState(720);
  // <640px only — a 7-column month grid leaves each day cell too narrow for
  // a real event pill (icon + text) to read as anything but "•t…"; every
  // mobile calendar app (Google/Apple included) solves this the same way —
  // dots only in the month grid, tap a day to see what's actually on it
  // (already wired up here via onDateClick's day-summary popup). Desktop
  // keeps the full pill unchanged.
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  useEffect(() => {
    function computeLayout() {
      const top = wrapperRef.current?.getBoundingClientRect().top ?? 0;
      // Below lg (1024px) the app shell's own bottom tab bar is `fixed
      // inset-x-0 bottom-0 h-[68px]` (see shell.tsx's ModuleBottomNav) —
      // outside normal flow, so it doesn't show up in any bounding-rect
      // measurement here. The page reserves room for it via `pb-[68px]` on
      // the content wrapper instead, which this calc didn't know about:
      // sizing the calendar to the *full* remaining viewport left that 68px
      // of padding hanging past the bottom of the screen, forcing a scroll
      // to reach the last row(s). Subtract it explicitly on the same
      // breakpoint the shell uses.
      const bottomNavHeight = window.innerWidth < 1024 ? 68 : 0;
      // Was a 520px floor — on a genuinely short phone (e.g. a 667px-tall
      // iPhone SE/8, vs. a 956px-tall iPhone 16) the real available space
      // after the header/toolbar/bottom-nav is well under that, so the
      // floor forced the calendar taller than the viewport could actually
      // hold, pushing it into a page scroll instead of fitting the screen —
      // exactly the "some sizes fine, some don't fit" inconsistency this was
      // supposed to avoid. Dropped to a much lower safety net that only
      // kicks in for extreme cases, so it actually follows real device
      // height instead of overriding it past a point.
      setCalendarHeight(Math.max(360, Math.round(window.innerHeight - top - 24 - bottomNavHeight)));
      setIsNarrowViewport(window.innerWidth < 640);
    }
    computeLayout();
    window.addEventListener("resize", computeLayout);
    return () => window.removeEventListener("resize", computeLayout);
  }, []);
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
      events
        // Month view shows a holiday right in front of the day number itself
        // (see renderDayCellContent — a small dot on a narrow/mobile column,
        // the short title in italic once there's room) instead of as one
        // more event in the cell body — keeping it in here too would show it
        // twice. Week/day/list views have no per-cell day number to attach
        // it to, so it stays a normal (unstyled, italic-text) event there —
        // see renderEventContent. Narrow month view drops every event, not
        // just holidays — renderDayCellContent renders the whole day's
        // items itself as one flex-wrap row of dots directly under the
        // number (matching the maintenance module's PM calendar reference
        // design), instead of FullCalendar's own one-event-per-row stack —
        // keeping them in fcEvents too would render each one twice.
        .filter((e) => !(view === "dayGridMonth" && (e.type === "holiday" || isNarrowViewport)))
        .map((e) => {
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
            // Desktop month view — plain colored text + its own dot (already
            // drawn in renderEventContent), no pale chip background/left
            // border around it, matching the maintenance module's PM
            // calendar reference (plain rows + "+N รายการ", not filled
            // pills). Narrow view is unaffected — it never reaches fcEvents
            // for month view at all (see the filter above).
            ...(view === "dayGridMonth" && !isNarrowViewport ? ["ebw-event-plain"] : []),
          ],
          extendedProps: { type: e.type, color, isTask: e.type === "task", muted: !!e.muted, mine: e.mine, leaveType: e.leaveType, done: !!e.done },
        };
      }),
    [events, colors, view, isNarrowViewport]
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

  useImperativeHandle(ref, () => ({
    jumpToDate: (date, view) => {
      if (view) changeView(view);
      jumpToDate(date);
    },
  }));

  function handleEventClick(arg: EventClickArg) {
    // A to-do chip has its own checkbox (see renderEventContent, which stops
    // propagation on it) — a click that reaches here is the title/body, so
    // it opens the edit dialog instead of the usual read-only preview card.
    // Someone else's to-do (visible in "all" scope) is read-only — nothing
    // to open.
    if (arg.event.extendedProps.type === "todo") {
      if (arg.event.extendedProps.mine !== false) onEditTodo?.(arg.event.id);
      return;
    }
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

  /** Month view only — replaces the plain day-number cell with, if a holiday
   *  falls on this date, a marker right BEFORE the number (asked for
   *  explicitly: "ให้แสดงไว้หน้าวันที่" — in front of the date, not after) —
   *  a small dot on a narrow/mobile column (no room for text there without
   *  overflowing into neighboring cells — that was the previous bug), the
   *  short title in italic once there's actually space for it. Both kept
   *  deliberately faint/neutral rather than the holiday category color —
   *  "ไม่ต้องเด่น ให้ดูรู้พอ" (subtle, just enough to notice), not competing
   *  with the date number or real events. Keeps the `fc-daygrid-day-number`
   *  class on the number itself so every existing today/weekend/other-month
   *  CSS rule (theme.css) still applies unchanged. */
  function renderDayCellContent(arg: DayCellContentArg) {
    const ymd = localYmd(arg.date);
    const holiday = events.find(
      (e) => e.type === "holiday" && ymd >= e.start.slice(0, 10) && ymd < e.end.slice(0, 10)
    );
    // Several titles carry a parenthetical official long-form after the
    // everyday name (e.g. "วันแม่แห่งชาติ (วันเฉลิมพระชนมพรรษา...)") — that
    // full string never fits legibly next to a date number no matter how far
    // it's shrunk, so show just the short name here and keep the full title
    // as a native hover tooltip for anyone who wants it.
    const shortTitle = holiday?.title.split(" (")[0];

    const numberRow = (
      // No-holiday days (the common case) center the number — event dots
      // below are centered in their own cell (justify-center in
      // renderEventContent), so a left-aligned number (flex's default
      // start-alignment, with nothing else in the row to push against)
      // sat visibly left of its own dot underneath it. That mismatch read
      // as the whole dot "leaning" out from under its date every time,
      // even though the dot itself was correctly centered — this was the
      // real cause behind the reported crookedness, not the dot's own
      // sizing/margin (verified fine via DevTools). A holiday day keeps the
      // number left-anchored so the italic title reads naturally after it.
      <div className={cn("flex items-baseline gap-1 min-w-0 w-full overflow-hidden", !holiday && "justify-center")}>
        {holiday &&
          (isNarrowViewport ? (
            <span
              title={holiday.title}
              className="h-[5px] w-[5px] rounded-full shrink-0 bg-[var(--ink-soft)]"
            />
          ) : (
            // Flex items default to min-width:auto (their content's own
            // width), which blocks truncate from ever kicking in — min-w-0 +
            // flex-1 forces it to actually shrink to the ellipsis instead of
            // spilling out of the cell.
            <span
              title={holiday.title}
              className="italic text-[10px] font-normal truncate min-w-0 flex-1 text-[var(--ink-soft)]"
            >
              {shortTitle}
            </span>
          ))}
        <a className="fc-daygrid-day-number shrink-0">{arg.dayNumberText}</a>
      </div>
    );

    // Narrow month view only — every one of the day's items (dropped from
    // fcEvents for this exact case, see its own comment) as one flex-wrap
    // row of small dots directly under the number, capped with an inline
    // "+N" once there's more than fit. Matches the maintenance module's PM
    // calendar mobile layout (apps/web/modules/maintenance/components/
    // pm-calendar.tsx) instead of FullCalendar's own one-event-per-row
    // stack, which is what actually made a multi-day item's dot land off
    // the day's own column in the first place (list-item mode didn't fully
    // fix that) — a manually laid-out row sidesteps the whole class of
    // "which day column does this segment belong to" bug entirely.
    if (isNarrowViewport && view === "dayGridMonth") {
      // Just dots, always — text rows (tried per an earlier reference photo)
      // read as messy/hard-to-read clutter at real phone width once actually
      // deployed ("ให้แสดงแค่จุดๆพอ" — just dots is enough). No count
      // threshold anymore, dots for every day that has anything.
      const DOT_CAP = 4;
      const items = events.filter((e) => {
        if (e.type === "holiday") return false;
        const start = e.start.slice(0, 10);
        const endRaw = e.end ? e.end.slice(0, 10) : start;
        const end = endRaw > start ? endRaw : start;
        return end === start ? ymd === start : ymd >= start && ymd < end;
      });
      return (
        <div className="flex flex-col items-center w-full">
          {numberRow}
          {items.length > 0 && (
            // Today's number is plain-text-styled now, same box model as
            // every other day (see that CSS rule's own history) — no more
            // per-day margin compensation needed here at all.
            <div className="flex flex-wrap items-center justify-center gap-0.5 px-0.5 pb-0.5">
              {items.slice(0, DOT_CAP).map((e) => (
                <span
                  key={e.id}
                  title={e.title}
                  className={cn("h-1.5 w-1.5 rounded-full shrink-0", e.done && "opacity-50")}
                  style={{ backgroundColor: e.colorHint ?? colors[e.type] }}
                />
              ))}
              {items.length > DOT_CAP && (
                <span className="text-[9px] leading-none text-[var(--ink-soft)]">+{items.length - DOT_CAP}</span>
              )}
            </div>
          )}
        </div>
      );
    }

    return numberRow;
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

    // Narrow month view never reaches this function at all — every one of
    // its events is dropped from fcEvents (see that filter's own comment)
    // in favor of renderDayCellContent drawing the whole day's dots itself
    // in one flex-wrap row, PM-calendar-style. This function only ever
    // renders the wide pill (or narrow week/day, which still gets it too —
    // those views run tall, not narrow, so there's real room for it there).
    if (type === "todo") {
      const done = !!arg.event.extendedProps.done;
      // Someone else's to-do (only reachable in "all" scope) is read-only —
      // no checkbox interaction, no pointer cursor, no click-to-edit.
      const mine = arg.event.extendedProps.mine !== false;
      return (
        <div className={cn("flex items-center gap-1.5 px-2 py-[3px] overflow-hidden leading-tight", mine && "cursor-pointer", done && "opacity-60")}>
          <span
            role="checkbox"
            aria-checked={done}
            aria-label={done ? "ทำเครื่องหมายว่ายังไม่เสร็จ" : "ทำเครื่องหมายว่าเสร็จแล้ว"}
            // Filled round dot, same as every other type — a hollow square
            // outline read as "no marker at all" next to the other types'
            // solid dots on desktop (mobile's own dot-row already always
            // draws it filled). Still fully clickable to toggle done.
            className={cn("flex h-3 w-3 shrink-0 items-center justify-center rounded-full border", mine && "cursor-pointer")}
            style={{ backgroundColor: color, borderColor: color }}
            onClick={(e) => {
              // Stops the click from also reaching FullCalendar's own
              // eventClick handler (which would otherwise open the edit
              // dialog right on top of the toggle) — see handleEventClick.
              if (!mine) return;
              e.stopPropagation();
              onToggleTodo?.(arg.event.id);
            }}
          >
            {done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
          </span>
          <span className={cn("truncate text-[11px] font-medium", done && "line-through")} style={{ color }}>
            {arg.event.title}
          </span>
        </div>
      );
    }
    // Holidays sit right under the date number as plain italic text — no
    // chip background/icon/dot — reading as a label on the date itself
    // (Google-Calendar style) rather than one more colored event pill
    // competing with tasks/meetings/leave.
    if (type === "holiday") {
      return (
        <div className="px-2 py-[1px] overflow-hidden leading-tight">
          <span className="truncate text-[11px] italic font-medium" style={{ color }}>
            {arg.event.title}
          </span>
        </div>
      );
    }
    // Leaves show a descriptive icon; everything else keeps a plain, always-
    // solid color dot — the previous filled-vs-hollow-ring "mine vs theirs"
    // distinction read as a half-empty/broken circle rather than a
    // deliberate signal (same "วงกลมไม่เต็ม อยากได้แบบเต็มๆ" feedback as the
    // narrow-view dot above). Past events fade via the .ebw-event-muted CSS
    // opacity rule (same color, just paler) instead.
    const Icon =
      type === "dayoff"
          ? CalendarOff
          : type === "leave" && leaveType
            ? leaveIconOf(leaveIconById[leaveType])
            : null;
    return (
      <div className="flex items-center gap-1.5 px-2 py-[3px] overflow-hidden leading-tight">
        {Icon ? (
          <Icon className="h-3 w-3 shrink-0" style={{ color }} />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
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
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
                view === opt.key
                  ? "bg-[var(--chart-blue)] text-white shadow-sm"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-white/60"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ebw-calendar" ref={wrapperRef}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          locale={thGregorianLocale}
          // Fixed height (computed above from the actual viewport) on wide
          // screens so busy vs empty months stay the same size and the page
          // can't bounce the scroll on navigation. Narrow month view went
          // through both extremes — "auto" + no expandRows (compact, but a
          // phone was left scrolling to see the last row), then forcing
          // full-height expandRows to fix that (but rows then stretched
          // with mostly-dead space under a couple of dots, "เปลืองพื้นที่...
          // ใช้ครึ่งเดียวเอง") — settling on "auto" without expandRows:
          // compact rows sized to their real content, which on a normal
          // month is short enough to need no scroll anyway, without
          // artificially inflating light rows to fill the screen.
          height={isNarrowViewport && view === "dayGridMonth" ? "auto" : calendarHeight}
          expandRows={!(isNarrowViewport && view === "dayGridMonth")}
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
          dayCellContent={renderDayCellContent}
          editable
          eventDurationEditable={false}
          // "auto" (the default) renders a multi-day event as one continuous
          // bar spanning across day columns — fine for the wide pill view,
          // but a dot has no meaningful "spanning" shape: centered inside
          // that wide bar, it lands at the visual midpoint between the start
          // and end day instead of sitting in either day's column, reading
          // as randomly crooked/off-grid. "list-item" gives every day its
          // own independent segment instead (no cross-column bar), which is
          // what a plain per-day dot needs — narrow month view only, since
          // the wide pill view's spanning bar is the whole point there.
          eventDisplay={isNarrowViewport && view === "dayGridMonth" ? "list-item" : "auto"}
          eventContent={renderEventContent}
          // Cells share one height; show as many events as fit and only surface
          // "+more" when they actually overflow the cell (not a fixed count).
          // That auto-fit math needs a *fixed* cell height to know when it's
          // full — under "auto" height (narrow month view, see above) there's
          // no fixed height to measure against, so `true` here silently fell
          // back to "show everything", piling 15+ stacked dots straight down
          // through the rows below instead of capping at a couple + "+N".
          // A narrow viewport gets an explicit small cap instead (2 for the
          // cramped month-grid cells, a little more elsewhere).
          dayMaxEvents={isNarrowViewport ? (view === "dayGridMonth" ? 2 : 3) : true}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          // "+N more" opens the same day popup as clicking the date itself
          // instead of FullCalendar's own bare popover — one consistent
          // summary UI per day, not two different-looking ones.
          moreLinkClick={(arg) => onDateClick?.(localYmd(arg.date))}
          // Narrow month-view cells only fit a dot or two before "+N" kicks
          // in — the full "อีก N รายการ" sentence doesn't fit next to them,
          // so it collapses to a bare "+N" chip there (desktop/week/day keep
          // the full sentence, same as always).
          moreLinkText={(n) => (isNarrowViewport && view === "dayGridMonth" ? `+${n}` : `อีก ${n} รายการ`)}
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
});
