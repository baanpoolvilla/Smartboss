"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/modules/report_task/components/ui/card";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Button } from "@/modules/report_task/components/ui/button";
import { DatePickerField } from "@/modules/report_task/components/shared/date-picker-field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/modules/report_task/components/ui/dropdown-menu";
import { getUser, getDepartment, departmentIdsOf } from "@/modules/report_task/lib/directory";
import { useLeaveStore } from "@/modules/report_task/store/leave-store";
import { useLeaveTypeStore } from "@/modules/report_task/store/leave-type-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useCalendarVisibilityStore } from "@/modules/report_task/store/calendar-visibility-store";
import { useRoutineDayOffStore, type DayOffOrigin } from "@/modules/report_task/store/routine-dayoff-store";
import {
  quotaForDepartment,
  expandRuleOccurrences,
  projectedRoutineQuotaTotal,
  weekdayLabelTh,
  WEEKDAY_SHORT_TH,
} from "@/modules/report_task/lib/routine-dayoff";
import { formatDate, addDays } from "@/modules/report_task/lib/format";
import { todayIso } from "@/modules/report_task/lib/now";
import { rangeLabel, inRange, type ViewRange } from "@/modules/report_task/lib/date-filter";
import { cn } from "@/modules/report_task/lib/utils";
import { User, Plus, X, Pencil, Check, Repeat, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { CalendarEvent } from "@/modules/report_task/types";

/** A single concrete day off for the month currently in view — either a
 * plain one-off pick, or one week's occurrence of a recurring rule. Both
 * render as the same pill, but moving/cancelling one writes back to a
 * different place depending on `origin` (see routine-dayoff-store). */
interface EffectiveDayOff {
  date: string;
  origin: DayOffOrigin;
}

function entryKey(e: EffectiveDayOff): string {
  return e.origin.kind === "manual" ? `manual:${e.date}` : `rule:${e.origin.ruleId}:${e.date}`;
}

// `holidays` is passed in already filtered to the viewer's selected
// countries (see calendar-view.tsx) — reading straight from the holiday
// store here would show every country anyone has ever browsed, not just
// the ones this person actually turned on.
export function LeaveSidebar({
  range,
  holidays,
}: {
  range: ViewRange;
  holidays: CalendarEvent[];
}) {
  const leaves = useLeaveStore((s) => s.leaves);
  const leaveTypes = useLeaveTypeStore((s) => s.types);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const hiddenUserIds = useCalendarVisibilityStore((s) => s.hiddenUserIds);
  const myDeptIds = new Set(departmentIdsOf([viewingAsUserId]));

  const companyMonthlyQuota = useRoutineDayOffStore((s) => s.companyMonthlyQuota);
  const useDepartmentOverrides = useRoutineDayOffStore((s) => s.useDepartmentOverrides);
  const departmentQuotas = useRoutineDayOffStore((s) => s.departmentQuotas);
  const allPickedDates = useRoutineDayOffStore((s) => s.pickedDates);
  const addPickedDate = useRoutineDayOffStore((s) => s.addPickedDate);
  const removePickedDate = useRoutineDayOffStore((s) => s.removePickedDate);
  const movePickedDate = useRoutineDayOffStore((s) => s.movePickedDate);
  const rules = useRoutineDayOffStore((s) => s.rules);
  const ruleExceptions = useRoutineDayOffStore((s) => s.ruleExceptions);
  const addRule = useRoutineDayOffStore((s) => s.addRule);
  const removeRule = useRoutineDayOffStore((s) => s.removeRule);
  const moveRuleOccurrence = useRoutineDayOffStore((s) => s.moveRuleOccurrence);
  const cancelRuleOccurrence = useRoutineDayOffStore((s) => s.cancelRuleOccurrence);
  const [newRoutineDate, setNewRoutineDate] = useState(todayIso());
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringWeekdays, setRecurringWeekdays] = useState<Set<number>>(new Set());
  const [recurringUntil, setRecurringUntil] = useState("");
  const [movingEntry, setMovingEntry] = useState<EffectiveDayOff | null>(null);
  const [moveTarget, setMoveTarget] = useState(todayIso());
  // Hidden by default so the card's default view is just the picked dates
  // themselves, not the add-form taking up space alongside them.
  const [showAddRoutine, setShowAddRoutine] = useState(false);

  // Follows whatever month the main calendar is currently showing — without
  // this, flipping the calendar to August still left this card silently
  // stuck on July (wherever `newRoutineDate` happened to default to), so the
  // quota/pill list looked wrong for the month actually on screen. Computed
  // during render (not an effect) so the very same render already reflects
  // it, same "adjust state on prop change" pattern used in
  // event-detail-dialog.tsx.
  const rangeMonthKey = `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, "0")}`;
  const [lastRangeMonthKey, setLastRangeMonthKey] = useState(rangeMonthKey);
  if (rangeMonthKey !== lastRangeMonthKey) {
    setLastRangeMonthKey(rangeMonthKey);
    setNewRoutineDate(`${rangeMonthKey}-01`);
  }

  // The pill list's own month, browsed independently with ‹ › — starts
  // wherever the calendar's currently on, but re-syncs whenever the calendar
  // navigates to a different month so the two don't drift apart.
  const [pillMonth, setPillMonth] = useState(rangeMonthKey);
  const [lastPillRangeMonthKey, setLastPillRangeMonthKey] = useState(rangeMonthKey);
  if (rangeMonthKey !== lastPillRangeMonthKey) {
    setLastPillRangeMonthKey(rangeMonthKey);
    setPillMonth(rangeMonthKey);
  }
  function shiftPillMonth(delta: number) {
    // pillMonth เป็นรูปแบบ "YYYY-MM" ที่โค้ดนี้สร้างเอง
    const [y, m] = pillMonth.split("-").map(Number) as [number, number];
    const d = new Date(y, m - 1 + delta, 1);
    setPillMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const targetMonth = newRoutineDate.slice(0, 7);
  const myQuota = quotaForDepartment(getUser(viewingAsUserId)?.departmentId, companyMonthlyQuota, departmentQuotas, useDepartmentOverrides);

  // Manual picks + every rule's expanded occurrences, both scoped to
  // `targetMonth` — the single source of truth for quota usage, the pill
  // list, and what's offered in the swap pickers below. A rule can belong
  // to anyone, not just the viewer, so this takes a userId rather than
  // always reading the viewer's own state.
  function effectiveDatesForMonth(userId: string, month: string): EffectiveDayOff[] {
    const manual = (allPickedDates[userId] ?? [])
      .filter((d) => d.slice(0, 7) === month)
      .map((date): EffectiveDayOff => ({ date, origin: { kind: "manual" } }));
    const fromRules = rules
      .filter((r) => r.userId === userId)
      .flatMap((r) =>
        expandRuleOccurrences(r, ruleExceptions, month).map(
          ({ date, naturalDate }): EffectiveDayOff => ({ date, origin: { kind: "rule", ruleId: r.id, naturalDate } })
        )
      );
    // Two rules can legitimately land on the same calendar date (e.g. two
    // separate weekly routines that happen to overlap, or — the bug this
    // guards against — the same weekday adopted twice from two different
    // synced series). Either way, a given day only counts once toward
    // quota/the pill list; showing/counting it per-rule instead of per-date
    // is what made "11/6 วัน" possible for a month with only ~5 Saturdays.
    const seen = new Set<string>();
    const deduped: EffectiveDayOff[] = [];
    for (const entry of [...manual, ...fromRules].sort((a, b) => a.date.localeCompare(b.date))) {
      if (seen.has(entry.date)) continue;
      seen.add(entry.date);
      deduped.push(entry);
    }
    return deduped;
  }

  const myEffectiveThisMonth = effectiveDatesForMonth(viewingAsUserId, targetMonth);
  const usedThisMonth = myEffectiveThisMonth.length;
  const myRules = rules.filter((r) => r.userId === viewingAsUserId);

  // The pill list below shows exactly one month at a time — `pillMonth`,
  // browsed with its own ‹ › nav — rather than every upcoming month stacked
  // in one long scroll. Reuses `myEffectiveThisMonth` when it's the same
  // month as the quota card to avoid computing it twice.
  const pillMonthEntries = pillMonth === targetMonth ? myEffectiveThisMonth : effectiveDatesForMonth(viewingAsUserId, pillMonth);

  function addRoutineDayOff() {
    if (usedThisMonth >= myQuota) {
      toast.error(`ครบโควตา ${myQuota} วัน/เดือนของเดือนนี้แล้ว`);
      return;
    }
    if (myEffectiveThisMonth.some((e) => e.date === newRoutineDate)) {
      toast.error("เลือกวันนี้ไว้แล้ว");
      return;
    }
    // Holiday `end` is exclusive (the day after its last actual day, see
    // data/mock.ts) — `h.end > date` (not `>=`) is what "date falls inside
    // [start, end)" actually means; `>=` would treat the day right after a
    // holiday as still overlapping it.
    const overlapsHoliday = holidays.some((h) => h.start <= newRoutineDate && h.end > newRoutineDate);
    addPickedDate(viewingAsUserId, newRoutineDate);
    toast[overlapsHoliday ? "info" : "success"](
      overlapsHoliday ? "วันนี้ตรงกับวันหยุดที่มีอยู่แล้ว — ยังนับเข้าโควตาตามปกติ" : "เพิ่มวันหยุดประจำแล้ว"
    );
  }

  function toggleRecurringWeekday(day: number) {
    setRecurringWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  // Native "Recurring" creation (Outlook-style: pick weekdays + an optional
  // end date) — a second way in besides confirming a detected external
  // series, for anyone not syncing an outside calendar at all.
  function addRecurringRoutine() {
    if (recurringWeekdays.size === 0) {
      toast.error("เลือกวันในสัปดาห์อย่างน้อย 1 วัน");
      return;
    }
    if (recurringUntil && recurringUntil < newRoutineDate) {
      toast.error("วันที่สิ้นสุดต้องอยู่หลังวันเริ่ม");
      return;
    }
    const alreadyCovered = Array.from(recurringWeekdays).filter((weekday) => myRules.some((r) => r.weekday === weekday));
    if (alreadyCovered.length > 0) {
      toast.error(`มีรูทีนวัน${alreadyCovered.map(weekdayLabelTh).join(", ")}อยู่แล้ว เลือกวันอื่นหรือลบรูทีนเดิมก่อน`);
      return;
    }
    // Only the currently-viewed month is checked against quota — same scope
    // as every other guard on this card. A weekday count varies month to
    // month (4 vs 5 occurrences), so this can't promise every future month
    // stays under quota, only that the month you're looking at does.
    const projectedTotal = projectedRoutineQuotaTotal(
      Array.from(recurringWeekdays),
      newRoutineDate,
      recurringUntil || undefined,
      targetMonth,
      myEffectiveThisMonth.map((e) => e.date)
    );
    if (projectedTotal > myQuota) {
      toast.error(`รูทีนนี้จะทำให้เดือนนี้เกินโควตา ${myQuota} วัน/เดือน (จะมี ${projectedTotal} วัน)`);
      return;
    }
    recurringWeekdays.forEach((weekday) => addRule(viewingAsUserId, weekday, "กำหนดเอง", newRoutineDate, undefined, recurringUntil || undefined));
    toast.success(`ตั้งวันหยุดประจำทำซ้ำทุก${Array.from(recurringWeekdays).map(weekdayLabelTh).join(", ")} แล้ว`);
    setIsRecurring(false);
    setRecurringWeekdays(new Set());
    setRecurringUntil("");
  }

  function startMove(entry: EffectiveDayOff) {
    setMovingEntry(entry);
    setMoveTarget(entry.date);
  }

  function confirmMove() {
    if (!movingEntry) return;
    const { date: fromDate, origin } = movingEntry;
    if (moveTarget === fromDate) {
      setMovingEntry(null);
      return;
    }
    const targetMonthKey = moveTarget.slice(0, 7);
    const targetEffective = effectiveDatesForMonth(viewingAsUserId, targetMonthKey);
    if (targetEffective.some((e) => e.date === moveTarget)) {
      toast.error("เลือกวันนี้ไว้แล้ว");
      return;
    }
    const targetQuota = quotaForDepartment(getUser(viewingAsUserId)?.departmentId, companyMonthlyQuota, departmentQuotas, useDepartmentOverrides);
    const targetUsage = targetEffective.filter((e) => e.date !== fromDate).length;
    if (targetUsage >= targetQuota) {
      toast.error(`ครบโควตา ${targetQuota} วัน/เดือนของเดือนที่ย้ายไปแล้ว`);
      return;
    }
    if (origin.kind === "manual") movePickedDate(viewingAsUserId, fromDate, moveTarget);
    else moveRuleOccurrence(origin.ruleId, origin.naturalDate, moveTarget);
    toast.success(`ย้ายวันหยุดประจำจาก ${formatDate(fromDate)} เป็น ${formatDate(moveTarget)} แล้ว`);
    setMovingEntry(null);
  }

  /** Manual pick → just delete it. Rule-derived occurrence → same choice
   *  Outlook gives on a recurring event: skip just this one, or stop the
   *  whole routine (see the pill's dropdown below). */
  function removeManualEntry(date: string) {
    removePickedDate(viewingAsUserId, date);
  }

  const monthLeave = leaves
    .filter((e) => inRange(e.start, range) && (!e.userId || !hiddenUserIds.includes(e.userId)))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const monthHolidays = holidays
    .filter((e) => inRange(e.start, range))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // Independent of `hiddenUserIds` on purpose — this card is "my own leave,"
  // not a slice of the team view, so hiding yourself from the team calendar
  // shouldn't also empty out your own summary.
  const myLeave = leaves
    .filter((e) => inRange(e.start, range) && e.userId === viewingAsUserId)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const leaveHeading = range.viewType === "timeGridDay" ? "ทีมที่ลาวันนี้" : range.viewType === "timeGridWeek" ? "ทีมที่ลาสัปดาห์นี้" : "ทีมที่ลา";
  const holidayHeading = range.viewType === "timeGridDay" ? "วันหยุดวันนี้" : range.viewType === "timeGridWeek" ? "วันหยุดสัปดาห์นี้" : "วันหยุดในเดือนนี้";
  const myHeading = range.viewType === "timeGridDay" ? "วันลาของฉันวันนี้" : range.viewType === "timeGridWeek" ? "วันลาของฉันสัปดาห์นี้" : "วันลาของฉันเดือนนี้";
  const emptyLeaveLabel = range.viewType === "timeGridDay" ? "ไม่มีวันลาวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีวันลาสัปดาห์นี้" : "ไม่มีวันลาในเดือนนี้";
  const emptyHolidayLabel = range.viewType === "timeGridDay" ? "ไม่มีวันหยุดราชการวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีวันหยุดราชการสัปดาห์นี้" : "ไม่มีวันหยุดราชการในเดือนนี้";
  const emptyMyLeaveLabel = range.viewType === "timeGridDay" ? "ไม่มีวันลาของฉันวันนี้" : range.viewType === "timeGridWeek" ? "ไม่มีวันลาของฉันสัปดาห์นี้" : "ไม่มีวันลาของฉันเดือนนี้";

  function renderPill(entry: EffectiveDayOff) {
    const key = entryKey(entry);
    const isMoving = movingEntry && entryKey(movingEntry) === key;
    const fromRule = entry.origin.kind === "rule";
    const ruleOrigin = entry.origin.kind === "rule" ? entry.origin : null;
    if (isMoving) {
      return (
        <span key={key} className="inline-flex items-center gap-1 text-xs bg-[var(--bg-soft)] rounded-full pl-2 pr-1 py-0.5">
          <DatePickerField value={moveTarget} onChange={setMoveTarget} minDate={todayIso()} className="h-6 text-xs" />
          <button type="button" onClick={confirmMove} aria-label="ยืนยันย้ายวัน" title="ยืนยัน">
            <Check className="h-3 w-3 text-[var(--brand-green-dark)] hover:opacity-70" />
          </button>
          <button type="button" onClick={() => setMovingEntry(null)} aria-label="ยกเลิกย้ายวัน" title="ยกเลิก">
            <X className="h-3 w-3 text-[var(--ink-soft)] hover:text-[var(--ink)]" />
          </button>
        </span>
      );
    }
    return (
      <span
        key={key}
        className={cn(
          "group inline-flex items-center gap-1 text-xs rounded-full pl-2 pr-1 py-0.5",
          fromRule ? "bg-sky-50 text-sky-900" : "bg-[var(--bg-soft)]"
        )}
        title={fromRule ? "จากรูทีนรายสัปดาห์ — ย้าย/ยกเลิกจะมีผลแค่สัปดาห์นี้" : undefined}
      >
        {fromRule && <Repeat className="h-3 w-3 shrink-0" />}
        {formatDate(entry.date)}
        {/* Action icons stay invisible until you hover/focus this pill — with
            a whole month of pills on screen at once, three icons apiece made
            the list read as noise before you'd even looked at a single date. */}
        <span className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button type="button" onClick={() => startMove(entry)} aria-label={`ย้ายวันหยุดประจำ ${formatDate(entry.date)}`} title="ย้ายวัน">
            <Pencil className="h-3 w-3 text-[var(--ink-soft)] hover:text-[var(--ink)]" />
          </button>
          {entry.origin.kind === "manual" ? (
            <button type="button" onClick={() => removeManualEntry(entry.date)} aria-label={`ลบวันหยุดประจำ ${formatDate(entry.date)}`} title="ลบ">
              <X className="h-3 w-3 text-[var(--ink-soft)] hover:text-[var(--ink)]" />
            </button>
          ) : (
            // Same choice Outlook gives when deleting a recurring event
            // instance — "this event" vs "the whole series" — instead of
            // guessing which one the click meant.
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button type="button" aria-label={`ตัวเลือกลบวันหยุดประจำ ${formatDate(entry.date)}`} title="ลบ">
                    <X className="h-3 w-3 text-[var(--ink-soft)] hover:text-[var(--ink)]" />
                  </button>
                }
              />
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => ruleOrigin && cancelRuleOccurrence(ruleOrigin.ruleId, ruleOrigin.naturalDate)}>
                  ยกเลิกแค่สัปดาห์นี้ ({formatDate(entry.date)})
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => ruleOrigin && removeRule(ruleOrigin.ruleId)}>
                  เลิกใช้ทั้งรูทีน
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      </span>
    );
  }

  return (
    <>
      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
            {leaveHeading}
            {monthLeave.length > 0 && (
              <span className="text-xs font-normal text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-2 py-0.5">
                {monthLeave.length} รายการ
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)}</p>
        </CardHeader>
        <CardContent className="space-y-3 max-h-80 overflow-y-auto">
          {monthLeave.length === 0 && (
            <p className="text-sm text-[var(--ink-soft)]">{emptyLeaveLabel}</p>
          )}
          {monthLeave.map((e) => {
            const user = e.userId ? getUser(e.userId) : undefined;
            return (
              <div key={e.id} className="flex items-center gap-2.5">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-[10px] bg-[var(--bg-soft)]">{user?.avatar}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-[var(--ink-soft)]">{formatDate(e.start)}</p>
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {e.leaveType ? leaveTypes.find((t) => t.id === e.leaveType)?.label ?? "ลา" : "ลา"}
                </Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{holidayHeading}</CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {monthHolidays.length === 0 && (
            <p className="text-sm text-[var(--ink-soft)]">{emptyHolidayLabel}</p>
          )}
          {monthHolidays.map((h) => {
            const scoped = h.departmentIds && h.departmentIds.length > 0;
            const isMine = scoped && h.departmentIds!.some((id) => myDeptIds.has(id));
            // `h.end` is exclusive (day after the last actual day, see
            // data/mock.ts) — a single-day holiday's end is start+1, which
            // would otherwise always read as "start - start+1" (looks like
            // a 2-day span for a 1-day holiday). Show the inclusive last
            // day instead, and skip the range entirely once that's the
            // same day as the start.
            const lastDay = addDays(h.end, -1);
            return (
              <div key={h.id} className={cn("flex items-center justify-between gap-2 text-sm rounded-md px-1.5 py-1 -mx-1.5", isMine && "bg-amber-50")}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate" title={h.title}>{h.title}</span>
                    {isMine && <Badge className="text-[10px] bg-amber-500 text-white shrink-0 hover:bg-amber-500">แผนกคุณ</Badge>}
                  </div>
                  {scoped && (
                    <p className="text-[11px] text-[var(--ink-soft)] truncate">
                      เฉพาะ {h.departmentIds!.map((id) => getDepartment(id)?.name).filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
                <span className="text-xs text-[var(--ink-soft)] shrink-0">
                  {formatDate(h.start)}
                  {lastDay !== h.start && ` - ${formatDate(lastDay)}`}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-[var(--line)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-[var(--ink-soft)]" /> วันหยุดของฉัน
          </CardTitle>
          <p className="text-xs text-[var(--ink-soft)]">{rangeLabel(range)}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-center">
              <p className="text-lg font-semibold tabular-nums">{myLeave.length}</p>
              <p className="text-[11px] text-[var(--ink-soft)]">วันลา</p>
            </div>
            <div className="rounded-lg bg-[var(--bg-soft)] px-3 py-2 text-center">
              <p className="text-lg font-semibold tabular-nums">{usedThisMonth}/{myQuota}</p>
              <p className="text-[11px] text-[var(--ink-soft)]">วันหยุดประจำ</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-[var(--ink-soft)]">{myHeading}</p>
            {myLeave.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">{emptyMyLeaveLabel}</p>
            ) : (
              <div className="space-y-1.5">
                {myLeave.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {e.leaveType ? leaveTypes.find((t) => t.id === e.leaveType)?.label ?? "ลา" : "ลา"}
                    </Badge>
                    <span className="text-xs text-[var(--ink-soft)] shrink-0">{formatDate(e.start)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-[var(--line)]">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftPillMonth(-1)}
                title="เดือนก่อนหน้า"
                aria-label="เดือนก่อนหน้า"
                className="flex items-center justify-center h-6 w-6 rounded-md text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <p className="text-[11px] font-medium text-[var(--ink-soft)]">
                {new Date(`${pillMonth}-01T00:00:00`).toLocaleDateString("th-TH-u-ca-gregory", { month: "long", year: "numeric" })}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftPillMonth(1)}
                  title="เดือนถัดไป"
                  aria-label="เดือนถัดไป"
                  className="flex items-center justify-center h-6 w-6 rounded-md text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddRoutine((v) => !v)}
                  title={showAddRoutine ? "ซ่อนฟอร์มเพิ่ม" : "เพิ่มวันหยุดประจำ"}
                  aria-pressed={showAddRoutine}
                  aria-label={showAddRoutine ? "ซ่อนฟอร์มเพิ่มวันหยุดประจำ" : "เพิ่มวันหยุดประจำ"}
                  className={cn(
                    "flex items-center justify-center h-6 w-6 rounded-md border transition-colors shrink-0",
                    showAddRoutine
                      ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                      : "border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]"
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {showAddRoutine && (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] p-2 space-y-2">
                {myRules.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-[var(--ink-soft)] flex items-center gap-1">
                      <Repeat className="h-3 w-3" /> รูทีนที่ตั้งไว้
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {myRules.map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-center gap-1 text-xs bg-[var(--accent)] text-[var(--brand-green-dark)] rounded-full pl-2 pr-1 py-0.5"
                        >
                          ทุกวัน{weekdayLabelTh(r.weekday)} ({r.label})
                          <button type="button" onClick={() => removeRule(r.id)} aria-label={`เลิกใช้รูทีน ${r.label}`} title="เลิกใช้รูทีนนี้">
                            <X className="h-3 w-3 hover:opacity-70" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  <DatePickerField value={newRoutineDate} onChange={setNewRoutineDate} minDate={todayIso()} />
                  <button
                    type="button"
                    onClick={() => setIsRecurring((v) => !v)}
                    title="ทำซ้ำทุกสัปดาห์"
                    aria-pressed={isRecurring}
                    className={cn(
                      "flex items-center justify-center h-9 w-9 rounded-md border transition-colors shrink-0",
                      isRecurring
                        ? "border-[var(--brand-green)] bg-[var(--accent)] text-[var(--brand-green-dark)]"
                        : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    )}
                  >
                    <Repeat className="h-4 w-4" />
                  </button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={isRecurring ? addRecurringRoutine : addRoutineDayOff}
                    title="เพิ่มวันหยุดประจำ"
                    aria-label="เพิ่มวันหยุดประจำ"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {isRecurring && (
                  <div className="rounded-lg border border-[var(--line)] bg-white p-2 space-y-2">
                    <div className="flex items-center gap-1">
                      {WEEKDAY_SHORT_TH.map((label, day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleRecurringWeekday(day)}
                          className={cn(
                            "h-7 w-7 rounded-full text-[11px] font-medium transition-colors shrink-0",
                            recurringWeekdays.has(day)
                              ? "bg-[var(--brand-green)] text-[var(--ink)]"
                              : "bg-white border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
                      <span className="shrink-0">ถึงวันที่ (ไม่บังคับ)</span>
                      <DatePickerField value={recurringUntil} onChange={setRecurringUntil} minDate={newRoutineDate} className="h-7 text-xs" />
                      {recurringUntil && (
                        <button type="button" onClick={() => setRecurringUntil("")} title="ไม่กำหนดวันสิ้นสุด" aria-label="ล้างวันสิ้นสุด">
                          <X className="h-3.5 w-3.5 hover:text-[var(--ink)]" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {pillMonthEntries.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">ยังไม่ได้เลือกวันหยุดประจำในเดือนนี้</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">{pillMonthEntries.map(renderPill)}</div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
