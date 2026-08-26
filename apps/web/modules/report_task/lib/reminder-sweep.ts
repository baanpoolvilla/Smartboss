import { departments } from "@/modules/report_task/lib/directory";
import { calendarDateOf, now, todayIso } from "@/modules/report_task/lib/now";
import { pendingToday } from "@/modules/report_task/lib/report-feed-compliance";
import { SYSTEM_USER_ID } from "@/modules/report_task/lib/task-penalty-sweep";
import type { ReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { CalendarEvent, Task, TodoItem } from "@/modules/report_task/types";

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

/** The latest (last) round of the day, in minutes-since-midnight — what
 * `remindBeforeCutoffMinutes` counts down to. -1 if the room has no cutoffs
 * configured (nothing to remind before). */
function lastCutoffMinutesOf(cutoffs: ReportTopic["cutoffs"]): number {
  let max = -1;
  for (const c of cutoffs) {
    const [h, m] = c.time.split(":").map(Number) as [number, number];
    max = Math.max(max, h * 60 + m);
  }
  return max;
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
}): ReminderSweepResult {
  const { tasks, meetings, todos, topics, posts, settings, alreadySent } = input;
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

  // ---- Reports: N minutes before a room's last daily cutoff, per person who hasn't posted ----
  if (settings.report.enabled) {
    const today = todayIso();
    const nowMinutes = now().getHours() * 60 + now().getMinutes();
    const topicById = new Map(topics.map((t) => [t.id, t]));
    const pending = pendingToday(topics, posts);
    // Group by room so a manager summary only counts each room once.
    const pendingByTopic = new Map<string, typeof pending>();
    for (const entry of pending) {
      const list = pendingByTopic.get(entry.topicId) ?? [];
      list.push(entry);
      pendingByTopic.set(entry.topicId, list);
    }
    for (const [topicId, entries] of pendingByTopic) {
      const topic = topicById.get(topicId);
      if (!topic) continue;
      const lastCutoffMin = lastCutoffMinutesOf(topic.cutoffs);
      if (lastCutoffMin < 0) continue; // no fixed round, nothing to count down to
      const minutesUntilCutoff = lastCutoffMin - nowMinutes;
      if (minutesUntilCutoff < 0) continue; // cutoff already passed today — that's a "missed", not an upcoming reminder
      const leadOptions = topic.remindBeforeCutoffMinutes != null ? [topic.remindBeforeCutoffMinutes] : settings.report.leadMinutes;
      for (const lead of leadOptions) {
        if (lead <= 0 || minutesUntilCutoff > lead) continue;
        if (settings.report.notifyPending) {
          for (const entry of entries) {
            const key = `report:${topicId}:${entry.userId}:${today}:${lead}`;
            if (alreadySent.has(key)) continue;
            newSentKeys.push(key);
            notifications.push({
              recipients: [entry.userId],
              byUserId: SYSTEM_USER_ID,
              message: `ยังไม่ได้ส่งรีพอตห้อง "${topic.name}" วันนี้ ใกล้ถึงรอบตัดยอดแล้ว`,
              link: `/report-task/report-feed?topic=${topicId}`,
            });
          }
        }
        if (settings.report.notifyManagerSummary) {
          const summaryKey = `report-summary:${topicId}:${today}:${lead}`;
          if (!alreadySent.has(summaryKey)) {
            newSentKeys.push(summaryKey);
            const headIds = new Set<string>();
            for (const d of departments) {
              if (topic.visibility?.departmentIds?.includes(d.id)) headIds.add(d.headId);
            }
            if (headIds.size > 0) {
              notifications.push({
                recipients: [...headIds],
                byUserId: SYSTEM_USER_ID,
                message: `ห้อง "${topic.name}" ยังมี ${entries.length} คนไม่ได้ส่งรีพอตวันนี้ ใกล้ถึงรอบตัดยอดแล้ว`,
                link: `/report-task/report-feed?topic=${topicId}`,
              });
            }
          }
        }
      }
    }
  }

  return { notifications, newSentKeys };
}
