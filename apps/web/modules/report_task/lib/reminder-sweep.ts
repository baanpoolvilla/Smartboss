import { departments, users, isOwner } from "@/modules/report_task/lib/directory";
import { calendarDateOf, localDateStr, now, todayIso } from "@/modules/report_task/lib/now";
import { pendingToday } from "@/modules/report_task/lib/report-feed-compliance";
import { effectiveRoundsOf, roundRunsOnDay, roundFrequencyOf, resolveRoundSubmitters } from "@/modules/report_task/lib/submission-rounds";
import { SYSTEM_USER_ID } from "@/modules/report_task/lib/task-penalty-sweep";
import type { ReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { ReportPost, ReportTopic, SubmissionRound, SubmitterGroup } from "@/modules/report_task/store/report-feed-store";
import type { CalendarEvent, Task, TodoItem } from "@/modules/report_task/types";

const DAY_MINUTES = 1440;

/** "YYYY-MM-DD" + N days — used by the day-ahead report reminder below to
 * find the future date a weekly/monthly round is actually due on. */
function addDays(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

/** Which lead-time list applies to this round. A room's own
 * `remindBeforeCutoffMinutes`, when set, wins over everything — the
 * settings UI only ever sets it to `0` now (room-settings-sheet.tsx's
 * "เตือนก่อนถึงรอบส่ง" switch, muted), which naturally yields zero
 * notifications below (every lead-check requires `lead > 0`), so this
 * doubles as the room's mute switch without a separate code path. Otherwise
 * picks the company-wide list by the round's own frequency (Daily/Weekly/
 * Monthly each have their own list, see `ReportReminderSettings`) instead of
 * one shared list — a "1 วันก่อน" point added for Weekly shouldn't also fire
 * every day on a Daily round sharing the same room/company. */
function leadMinutesForRound(topic: ReportTopic, round: SubmissionRound, settings: ReminderSettings): number[] {
  if (topic.remindBeforeCutoffMinutes != null) return [topic.remindBeforeCutoffMinutes];
  const freq = roundFrequencyOf(round);
  if (freq === "monthly") return settings.report.monthlyLeadMinutes ?? settings.report.leadMinutes;
  if (freq === "weekly") return settings.report.weeklyLeadMinutes ?? settings.report.leadMinutes;
  return settings.report.leadMinutes;
}

export interface ReminderNotification {
  recipients: string[];
  byUserId: string;
  message: string;
  link?: string;
}

export interface ReminderSweepResult {
  notifications: ReminderNotification[];
  /** Dedup keys to add to the sent-log so the same reminder never fires
   * twice — see the sweep route for how this gets persisted. */
  newSentKeys: string[];
}

/**
 * Pure — takes a snapshot of everything a reminder could fire on, plus the
 * set of dedup keys already sent, and returns exactly what's newly due.
 * Same shape as `task-penalty-sweep.ts`'s `sweepAutoPenalties`: no I/O here,
 * the caller (the sweep route) is responsible for reading the snapshot in
 * and writing `notifications`/`newSentKeys` back out.
 *
 * Each notification has its own dedup key (`newSentKeys`) so re-running this
 * every 60s — or after a gap where nobody had a tab open — never re-sends
 * something already delivered, while still catching anything missed.
 * Deliberately doesn't take `DateExemptions` (approved-leave exceptions) —
 * a rare edge case where someone on leave might get one extra nudge, traded
 * for keeping this callable from a stateless server route without wiring up
 * the exemptions store there too.
 */
export function computeReminders(input: {
  tasks: Task[];
  meetings: CalendarEvent[];
  todos: TodoItem[];
  topics: ReportTopic[];
  posts: ReportPost[];
  settings: ReminderSettings;
  alreadySent: Set<string>;
  /** Needed only by the day-ahead report reminder below (`resolveRoundSubmitters`
   * reads groups for `mode: "groups"` rounds) — defaults to none for callers
   * that don't have it handy. */
  groups?: SubmitterGroup[];
}): ReminderSweepResult {
  const { tasks, meetings, todos, topics, posts, settings, alreadySent, groups = [] } = input;
  const notifications: ReminderNotification[] = [];
  const newSentKeys: string[] = [];

  // ---- Tasks: N minutes before the due moment (dueDate's day + dueTime, 23:59 if unset) ----
  if (settings.task.enabled && settings.task.leadMinutes.length > 0) {
    const nowMs = now().getTime();
    for (const t of tasks) {
      if (t.status === "done") continue;
      const dueMs = new Date(`${calendarDateOf(t.dueDate)}T${t.dueTime || "23:59"}:00`).getTime();
      const minutesUntil = (dueMs - nowMs) / 60_000;
      if (minutesUntil < 0) continue; // already overdue — that's task-penalty-sweep's job, not this one
      for (const lead of settings.task.leadMinutes) {
        if (minutesUntil > lead) continue;
        const key = `task:${t.id}:${lead}`;
        if (alreadySent.has(key)) continue;
        const recipients = new Set<string>();
        if (settings.task.notifyAssignee) for (const id of t.assigneeIds) recipients.add(id);
        if (settings.task.notifyAssigner) recipients.add(t.assignedById);
        if (settings.task.notifyDeptHead) {
          for (const d of departments) {
            if (t.departmentIds.includes(d.id)) recipients.add(d.headId);
          }
        }
        newSentKeys.push(key);
        if (recipients.size === 0) continue;
        // Whole days read as "3 วัน", not "4320 นาที" — anything shorter than
        // a day falls back to the same ชม./นาที phrasing the meeting
        // reminder above already uses, since it's the same kind of lead time.
        const remainingLabel =
          minutesUntil < 1 ? "ตอนนี้" : minutesUntil % 1440 === 0 ? `อีก ${minutesUntil / 1440} วัน` : minutesUntil >= 60 ? `อีก ${Math.round(minutesUntil / 60)} ชม.` : `อีก ${Math.round(minutesUntil)} นาที`;
        notifications.push({
          recipients: [...recipients],
          byUserId: SYSTEM_USER_ID,
          message: `งาน "${t.title}" ใกล้ถึงกำหนดส่ง${minutesUntil < 1 ? "" : `ใน${remainingLabel}`}`,
          link: `/report-task/tasks?task=${t.id}`,
        });
      }
    }
  }

  // ---- Meetings: N minutes before start ----
  if (settings.meeting.enabled) {
    const nowMs = now().getTime();
    for (const m of meetings) {
      const minutesUntil = (new Date(m.start).getTime() - nowMs) / 60_000;
      if (minutesUntil < 0) continue; // already started
      // A meeting's own `reminderMinutes` (set at creation) wins over the
      // company-wide default — same "room override, company default"
      // relationship as `ReportTopic.remindBeforeCutoffMinutes` below.
      const leadOptions = m.reminderMinutes != null ? [m.reminderMinutes] : settings.meeting.leadMinutes;
      for (const lead of leadOptions) {
        if (minutesUntil > lead) continue;
        const key = `meeting:${m.id}:${lead}`;
        if (alreadySent.has(key)) continue;
        const recipients = settings.meeting.notifyAttendees
          ? m.attendeeIds?.length
            ? m.attendeeIds
            : m.createdById
              ? [m.createdById]
              : []
          : [];
        newSentKeys.push(key);
        if (recipients.length === 0) continue;
        notifications.push({
          recipients,
          byUserId: SYSTEM_USER_ID,
          message: `ประชุม "${m.title}" เริ่มในอีก ${Math.round(lead)} นาที`,
          link: "/report-task/calendar",
        });
      }
    }
  }

  // ---- To-dos: N minutes before date+time, opt-in per item ----
  // Unlike tasks/meetings there's no company-wide default here — a to-do
  // only reminds if `reminderMinutes` was set when it was created.
  {
    const nowMs = now().getTime();
    for (const td of todos) {
      if (td.done || td.reminderMinutes == null) continue;
      const dueMs = new Date(`${td.date}T${td.time || "00:00"}:00`).getTime();
      const minutesUntil = (dueMs - nowMs) / 60_000;
      if (minutesUntil < 0 || minutesUntil > td.reminderMinutes) continue;
      const key = `todo:${td.id}:${td.reminderMinutes}`;
      if (alreadySent.has(key)) continue;
      newSentKeys.push(key);
      notifications.push({
        recipients: [td.userId],
        byUserId: SYSTEM_USER_ID,
        message: `สิ่งที่ต้องทำ "${td.title}" ใกล้ถึงเวลาแล้ว`,
        link: "/report-task/calendar",
      });
    }
  }

  // ---- Reports: N minutes before EACH round's own cutoff, per person who hasn't posted that round ----
  // Grouped by (topic, round) — not just topic — since Weekly/Monthly rounds
  // added on top of Daily can share a room but have their own cutoff *time*
  // and their own name worth calling out ("แจ้งเตือนว่า พนักงานมีรายงาน
  // รายเดือน รายอาทิตย์"). Counting down to the topic's single latest cutoff
  // (the old behavior) would tell someone who still owes an 18:00 Daily
  // round "ใกล้ถึงรอบตัดยอดแล้ว" too early/late whenever a different round
  // in the same room closes later that day (e.g. a 20:00 Weekly round) — the
  // countdown has to be relative to *that person's own outstanding round*.
  if (settings.report.enabled) {
    const today = todayIso();
    const nowMinutes = now().getHours() * 60 + now().getMinutes();
    const topicById = new Map(topics.map((t) => [t.id, t]));
    const pending = pendingToday(topics, posts);
    // Group by (room, round) so a manager summary counts each round once,
    // and the per-person countdown below uses that round's own cutoff time.
    const pendingByTopicRound = new Map<string, typeof pending>();
    for (const entry of pending) {
      const groupKey = `${entry.topicId}:${entry.roundId}`;
      const list = pendingByTopicRound.get(groupKey) ?? [];
      list.push(entry);
      pendingByTopicRound.set(groupKey, list);
    }
    for (const [groupKey, entries] of pendingByTopicRound) {
      const first = entries[0]!;
      const topic = topicById.get(first.topicId);
      if (!topic) continue;
      const round = effectiveRoundsOf(topic).find((r) => r.id === first.roundId);
      if (!round) continue;
      const [h, m] = first.roundTime.split(":").map(Number) as [number, number];
      const cutoffMin = h * 60 + m;
      const minutesUntilCutoff = cutoffMin - nowMinutes;
      if (minutesUntilCutoff < 0) continue; // cutoff already passed today — that's a "missed", not an upcoming reminder
      const leadOptions = leadMinutesForRound(topic, round, settings);
      // "Daily Report" reads as noise on a room where every round already is
      // one (the common case today) — only worth naming the round when this
      // room actually has more than one kind of round in force at all, so
      // existing single-round rooms keep their exact old wording.
      const namesRound = effectiveRoundsOf(topic).length > 1;
      const roundPhrase = namesRound ? ` "${first.roundLabel}"` : "";
      for (const lead of leadOptions) {
        // Whole-day leads (1440+, e.g. "1 วันก่อน") are handled by the
        // day-ahead block right below this loop instead — a same-day
        // countdown can't express "the day before a Friday-only weekly
        // round" since that round isn't even due today.
        if (lead <= 0 || lead >= DAY_MINUTES || minutesUntilCutoff > lead) continue;
        if (settings.report.notifyPending) {
          for (const entry of entries) {
            const key = `report:${groupKey}:${entry.userId}:${today}:${lead}`;
            if (alreadySent.has(key)) continue;
            newSentKeys.push(key);
            notifications.push({
              recipients: [entry.userId],
              byUserId: SYSTEM_USER_ID,
              message: `ยังไม่ได้ส่งรีพอต${roundPhrase} ห้อง "${topic.name}" วันนี้ ใกล้ถึงรอบตัดยอดแล้ว`,
              link: `/report-task/report-feed?topic=${topic.id}`,
            });
          }
        }
        if (settings.report.notifyManagerSummary) {
          const summaryKey = `report-summary:${groupKey}:${today}:${lead}`;
          if (!alreadySent.has(summaryKey)) {
            newSentKeys.push(summaryKey);
            // Department heads of this room's own department(s), plus every
            // company owner regardless of which room this is — an owner has
            // no single department to be "head" of, so without this they
            // never got this summary for any room at all, unlike a dept
            // head who at least gets their own ("owner ควรได้รับแจ้งเตือน
            // สรุป...ทุกห้อง").
            const headIds = new Set<string>();
            for (const d of departments) {
              if (topic.visibility?.departmentIds?.includes(d.id)) headIds.add(d.headId);
            }
            for (const u of users) {
              if (isOwner(u.id)) headIds.add(u.id);
            }
            if (headIds.size > 0) {
              notifications.push({
                recipients: [...headIds],
                byUserId: SYSTEM_USER_ID,
                message: `ห้อง "${topic.name}" ยังมี ${entries.length} คนไม่ได้ส่งรีพอต${roundPhrase}วันนี้ ใกล้ถึงรอบตัดยอดแล้ว`,
                link: `/report-task/report-feed?topic=${topic.id}`,
              });
            }
          }
        }
      }
    }

    // ---- Reports (day-ahead): whole-day leads look ahead to a future date
    // a round is actually due on, instead of counting down within today —
    // this is what makes "แจ้งเตือนก่อน 1 วัน" work for a Friday-only weekly
    // round on Thursday. Fires for every round (daily included, if someone
    // configures a day-lead for one), but it's the only path that matters
    // for weekly/monthly, since those never show up in `pendingToday` before
    // their actual due date. Deliberately ignores DateExemptions the same
    // way `roundComplianceStatus` does for weekly/monthly (see
    // roundIgnoresDateExemptions) — a period report reminds on schedule
    // whether or not the due date lands on a holiday or someone's leave.
    for (const topic of topics) {
      const namesRound = effectiveRoundsOf(topic).length > 1;
      for (const round of effectiveRoundsOf(topic)) {
        const leadOptions = leadMinutesForRound(topic, round, settings);
        const dayLeads = [...new Set(leadOptions.filter((m) => m >= DAY_MINUTES && m % DAY_MINUTES === 0).map((m) => m / DAY_MINUTES))];
        if (dayLeads.length === 0) continue;
        const roundPhrase = namesRound ? ` "${round.label}"` : "";
        for (const dayLead of dayLeads) {
          const targetDate = addDays(today, dayLead);
          if (!roundRunsOnDay(round, targetDate)) continue;
          const recipients = resolveRoundSubmitters(round, topic.visibility, groups);
          if (recipients.length === 0) continue;
          if (settings.report.notifyPending) {
            for (const userId of recipients) {
              const key = `report-day:${topic.id}:${round.id}:${targetDate}:${userId}:${dayLead}`;
              if (alreadySent.has(key)) continue;
              newSentKeys.push(key);
              notifications.push({
                recipients: [userId],
                byUserId: SYSTEM_USER_ID,
                message: `รีพอต${roundPhrase} ห้อง "${topic.name}" ใกล้ถึงกำหนดส่งในอีก ${dayLead} วัน (${targetDate})`,
                link: `/report-task/report-feed?topic=${topic.id}`,
              });
            }
          }
          if (settings.report.notifyManagerSummary) {
            const summaryKey = `report-day-summary:${topic.id}:${round.id}:${targetDate}:${dayLead}`;
            if (!alreadySent.has(summaryKey)) {
              newSentKeys.push(summaryKey);
              const headIds = new Set<string>();
              for (const d of departments) {
                if (topic.visibility?.departmentIds?.includes(d.id)) headIds.add(d.headId);
              }
              for (const u of users) {
                if (isOwner(u.id)) headIds.add(u.id);
              }
              if (headIds.size > 0) {
                notifications.push({
                  recipients: [...headIds],
                  byUserId: SYSTEM_USER_ID,
                  message: `ห้อง "${topic.name}" มีรีพอต${roundPhrase} ถึงกำหนดส่งในอีก ${dayLead} วัน (${targetDate}) — ${recipients.length} คนต้องส่ง`,
                  link: `/report-task/report-feed?topic=${topic.id}`,
                });
              }
            }
          }
        }
      }
    }
  }

  return { notifications, newSentKeys };
}
