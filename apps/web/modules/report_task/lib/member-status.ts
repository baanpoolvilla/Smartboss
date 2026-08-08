import type { CalendarEvent } from "@/modules/report_task/types";
import type { RoutineDayOffRule } from "@/modules/report_task/store/routine-dayoff-store";
import { expandRule } from "@/modules/report_task/lib/routine-dayoff";
import { todayIso, calendarDateOf } from "@/modules/report_task/lib/now";

/**
 * What a member is doing right now, derived only from data this app
 * actually has — there's no login/session tracking, so "online" in the
 * literal sense isn't knowable for anyone but the current viewer. This
 * instead answers "are they at work and free" from real records: an
 * approved leave covering today, a routine day off today, or a meeting
 * happening at this exact moment.
 */
export type MemberWorkStatus = "leave" | "dayoff" | "meeting" | "working";

function coversToday(e: CalendarEvent, ymd: string): boolean {
  if (e.allDay) return calendarDateOf(e.start) <= ymd && calendarDateOf(e.end) >= ymd;
  return calendarDateOf(e.start) === ymd;
}

export function getMemberWorkStatus(
  userId: string,
  nowMs: number,
  data: {
    leaves: CalendarEvent[];
    meetings: CalendarEvent[];
    routinePickedDates: Record<string, string[]>;
    routineRules: RoutineDayOffRule[];
    routineRuleExceptions: Record<string, string>;
  }
): MemberWorkStatus {
  const ymd = todayIso();

  if (data.leaves.some((l) => l.userId === userId && coversToday(l, ymd))) return "leave";

  const pickedOff = (data.routinePickedDates[userId] ?? []).includes(ymd);
  const ruleOff =
    !pickedOff &&
    data.routineRules.some(
      (r) => r.userId === userId && expandRule(r, data.routineRuleExceptions, ymd.slice(0, 7)).includes(ymd)
    );
  if (pickedOff || ruleOff) return "dayoff";

  const inMeetingNow = data.meetings.some((m) => {
    if (m.allDay) return false;
    if (!(m.attendeeIds?.includes(userId) || m.createdById === userId)) return false;
    return nowMs >= new Date(m.start).getTime() && nowMs <= new Date(m.end).getTime();
  });
  if (inMeetingNow) return "meeting";

  return "working";
}

// Maps onto Microsoft Teams' own presence set. Three of the four are backed
// by real data here; "away" (idle for a few minutes) has no real signal in
// an app with no session/activity tracking, so nothing currently resolves
// to it — it's kept so the color scale reads correctly if that ever changes.
export const presenceColor: Record<MemberWorkStatus, string> = {
  working: "var(--brand-green)", // online
  meeting: "var(--chart-red)", // busy — Teams itself auto-sets this from your calendar
  leave: "#9ca3af", // offline
  dayoff: "#9ca3af", // offline
};

export const presenceLabel: Record<MemberWorkStatus, string> = {
  working: "ออนไลน์",
  meeting: "ไม่ว่าง",
  leave: "ออฟไลน์",
  dayoff: "ออฟไลน์",
};

export function isOnline(status: MemberWorkStatus): boolean {
  return status === "working";
}
