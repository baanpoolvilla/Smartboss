import { departments, users, isOwner } from "@/modules/report_task/lib/directory";
import { meetingLink } from "@/modules/report_task/lib/meeting-link";
import { calendarDateOf, localDateStr, now, todayIso } from "@/modules/report_task/lib/now";
import { pendingToday } from "@/modules/report_task/lib/report-feed-compliance";
import {
  effectiveRoundsOf,
  roundRunsOnDay,
  roundFrequencyOf,
  resolveRoundSubmitters,
  earlyPostsForRound,
  DEFAULT_EARLY_SUBMIT_DAYS,
  type EarlySubmitDays,
} from "@/modules/report_task/lib/submission-rounds";
import { SYSTEM_USER_ID } from "@/modules/report_task/lib/task-penalty-sweep";
import { DEFAULT_TASK_MORNING_TIME, type ReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { ReportPost, ReportTopic, SubmissionRound, SubmitterGroup } from "@/modules/report_task/store/report-feed-store";
import type { CalendarEvent, Task, TodoItem } from "@/modules/report_task/types";
import { isPersonalTask } from "@/modules/report_task/lib/personal-task";

const DAY_MINUTES = 1440;

/** งานรอตรวจค้างนานเท่านี้ (วัน นับจากวันที่เสร็จ) แล้วเตือนคนที่เปิดงานให้ — "2 เดือน" */
export const REVIEW_STALE_DAYS = 60;
/** เกินกี่ชิ้นต่อคนในรอบเดียว แล้วรวมเป็นแจ้งเตือนเดียว */
const REVIEW_STALE_GROUP_OVER = 3;

/** รอบที่เลยเวลามาไม่เกินนี้ยังเตือน (เช่น ไม่มีใครเปิดเว็บตอน 08:30 แต่เปิดตอน 09:00) — เกินนี้ข้าม ไม่เตือนย้อนหลังกลางดึก */
export const TASK_ROUND_GRACE_MS = 6 * 3600_000;

export interface TaskDueRound {
  /** ใช้ในคีย์กันส่งซ้ำ: d{N} = เช้าของ N วันก่อน · m{นาที} = ก่อนเวลาส่ง */
  tag: string;
  fireAt: number;
  dueMs: number;
  /** ต่อท้าย `งาน "ชื่อ" ` */
  text: string;
}

/** "ศ. 24 ต.ค." */
function thaiShortDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });
}

/** 90 → "1 ชม. 30 นาที" */
function hoursMinutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ชม.` : "", m ? `${m} นาที` : ""].filter(Boolean).join(" ");
}

/**
 * รอบเตือนของงานหนึ่งชิ้น (ยังไม่ดูว่าถึงเวลาหรือส่งไปแล้ว)
 *  - จุดที่เป็นวันเต็ม (3 วัน, 1 วัน) → เช้าของวันนั้นตามเวลาที่ตั้ง (ค่าเริ่มต้น 08:30)
 *  - เช้าวันครบกำหนด (ปิดได้ในตั้งค่า)
 *  - จุดชั่วโมง/นาที → นับถอยจากเวลาส่ง ใช้เฉพาะงานที่ใส่เวลาส่ง (งานไม่มีเวลา = 23:59 นับแล้วได้เวลากลางดึก)
 * รอบที่ตกหลังเวลาส่งไปแล้ว (เช่น ส่ง 08:00 แต่ตั้งเตือนเช้า 08:30) ตัดทิ้ง
 */
export function taskDueRounds(t: Task, s: ReminderSettings["task"]): TaskDueRound[] {
  const day = calendarDateOf(t.dueDate);
  const dueMs = new Date(`${day}T${t.dueTime || "23:59"}:00`).getTime();
  if (!Number.isFinite(dueMs)) return [];
  const morning = /^\d{2}:\d{2}$/.test(s.morningTime ?? "") ? s.morningTime! : DEFAULT_TASK_MORNING_TIME;
  const dayLeads = new Set(s.leadMinutes.filter((l) => l > 0 && l % DAY_MINUTES === 0).map((l) => l / DAY_MINUTES));
  if (s.remindOnDueDay !== false) dayLeads.add(0);
  const rounds: TaskDueRound[] = [];
  for (const n of dayLeads) {
    const fireAt = new Date(`${addDays(day, -n)}T${morning}:00`).getTime();
    if (fireAt >= dueMs) continue;
    const text =
      n === 0
        ? `ครบกำหนดวันนี้${t.dueTime ? ` เวลา ${t.dueTime} น.` : ""}`
        : `ครบกำหนด${n === 1 ? "พรุ่งนี้" : `อีก ${n} วัน`} (${thaiShortDay(day)}${t.dueTime ? ` ${t.dueTime} น.` : ""})`;
    rounds.push({ tag: `d${n}`, fireAt, dueMs, text });
  }
  if (t.dueTime) {
    for (const l of new Set(s.leadMinutes.filter((x) => x > 0 && x % DAY_MINUTES !== 0))) {
      rounds.push({ tag: `m${l}`, fireAt: dueMs - l * 60_000, dueMs, text: `ครบกำหนดอีก ${hoursMinutesLabel(l)} (${t.dueTime} น.)` });
    }
  }
  return rounds;
}

/** "20/10/2569" — วันที่แบบที่คนในบริษัทอ่าน (พ.ศ.) */
function formatThaiDay(iso: string): string {
  const [y = "", m = "", d = ""] = calendarDateOf(iso).split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

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
/**
 * ช่วงเตือนที่ "เข้ามาแล้ว" (เหลือเวลา ≤ ช่วงนั้น) เรียงจากใกล้สุดก่อน — ใช้ตัดสินว่ารอบนี้ต้องเตือนไหม
 *
 * เดิมวนทุกช่วงแล้วเตือนทุกช่วงที่ยังไม่เคยส่ง — งานที่สร้างตอนใกล้กำหนดอยู่แล้ว (เหลือ 9 ชม.) อยู่ใน
 * ทั้งช่วง 3 วันและ 1 วันพร้อมกัน ได้แจ้งเตือนข้อความเดียวกัน 2 อันในรอบเดียว ("ทำไมแจ้งเตือนซ้ำ 2 รอบ")
 * ตอนนี้: เตือนครั้งเดียวตามช่วงที่ใกล้สุด แล้วนับช่วงที่ใหญ่กว่า (เลยมาแล้ว) ว่าส่งแล้วด้วย
 */
function crossedLeads(leads: number[], minutesUntil: number): number[] {
  return [...new Set(leads)].filter((lead) => minutesUntil <= lead).sort((a, b) => a - b);
}

/**
 * ช่วงที่เข้ามาแล้วแต่ยังไม่บันทึกว่าส่ง → บันทึกทั้งหมด · คืน true = ต้องเตือนรอบนี้ (ช่วงใกล้สุดยังไม่เคยส่ง)
 * ช่วงใกล้สุดส่งไปแล้ว เหลือแค่ช่วงใหญ่ที่เพิ่งเพิ่มในตั้งค่า (เลยไปแล้ว) = บันทึกเฉย ๆ ไม่เตือนย้อนหลัง
 */
function claimLeads(crossed: number[], keyOf: (lead: number) => string, alreadySent: Set<string>, newSentKeys: string[]): boolean {
  const nearest = crossed[0];
  if (nearest === undefined) return false;
  const unsent = crossed.filter((lead) => !alreadySent.has(keyOf(lead)));
  if (unsent.length === 0) return false;
  for (const lead of unsent) newSentKeys.push(keyOf(lead));
  return !alreadySent.has(keyOf(nearest));
}

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
  /** รอบรายสัปดาห์/รายเดือนส่งล่วงหน้าได้กี่วัน — คนที่ส่งล่วงหน้าแล้วไม่ถูกเตือน */
  earlySubmitDays?: EarlySubmitDays;
}): ReminderSweepResult {
  const {
    tasks,
    meetings,
    todos,
    topics,
    posts,
    settings,
    alreadySent,
    groups = [],
    earlySubmitDays = DEFAULT_EARLY_SUBMIT_DAYS,
  } = input;
  const notifications: ReminderNotification[] = [];
  const newSentKeys: string[] = [];

  // ---- งานใกล้ครบกำหนด ----
  // จุด "N วันก่อน" เตือนตอนเช้าตามเวลาที่ตั้ง (เดิมนับถึง 23:59 ของวันครบกำหนด ⇒ เด้งตอนเที่ยงคืน "ไม่สะดวกดูแจ้งเตือน" 23/10/2569)
  // + เช้าวันครบกำหนด · จุดชั่วโมง/นาทีใช้กับงานที่ใส่เวลาส่งเท่านั้น — ดู taskDueRounds
  if (settings.task.enabled) {
    const nowMs = now().getTime();
    for (const t of tasks) {
      if (t.status === "done") continue;
      const rounds = taskDueRounds(t, settings.task);
      if (rounds.length === 0 || nowMs >= rounds[0]!.dueMs) continue; // เลยกำหนดแล้ว — งานของ task-penalty-sweep
      const keyOf = (r: TaskDueRound) => `taskr:${t.id}:${calendarDateOf(t.dueDate)}T${t.dueTime ?? ""}:${r.tag}`;
      // ทุกรอบที่ถึงเวลาแล้ว บันทึกว่าส่งทั้งหมด — แต่เตือนแค่รอบล่าสุดรอบเดียว (ไม่เด้งรัว ๆ ย้อนหลัง)
      const reached = rounds.filter((r) => r.fireAt <= nowMs).sort((a, b) => b.fireAt - a.fireAt);
      const unsent = reached.filter((r) => !alreadySent.has(keyOf(r)));
      if (unsent.length === 0) continue;
      for (const r of unsent) newSentKeys.push(keyOf(r));
      const latest = reached[0]!;
      if (alreadySent.has(keyOf(latest))) continue;
      // เลยเวลารอบนั้นนานแล้ว (ไม่มีใครเปิดเว็บ/เซิร์ฟเวอร์ปิด) หรือรอบนั้นผ่านไปก่อนสร้างงาน — ไม่เตือนย้อนหลัง
      if (nowMs - latest.fireAt > TASK_ROUND_GRACE_MS) continue;
      const createdMs = Date.parse(t.createdAt);
      if (Number.isFinite(createdMs) && createdMs > latest.fireAt) continue;

      const recipients = new Set<string>();
      if (settings.task.notifyAssignee) for (const id of t.assigneeIds) recipients.add(id);
      // งานส่วนตัว (เปิดให้ตัวเอง): เตือนเจ้าของเสมอ ไม่ว่าตั้งค่าจะปิดการเตือนผู้รับงานไว้ไหม
      // และไม่เตือนหัวหน้า — หัวหน้ามองไม่เห็นงานนี้ ชื่องานห้ามหลุดไปทางแจ้งเตือน (personal-task.ts)
      if (isPersonalTask(t)) {
        recipients.clear();
        recipients.add(t.assignedById);
      } else if (settings.task.notifyDeptHead) {
        for (const d of departments) {
          // CEO ที่เป็นหัวหน้าแผนกด้วย ไม่ได้เตือนงานคนอื่น (27/10/2569) — งานตัวเองได้จาก notifyAssignee อยู่แล้ว
          if (t.departmentIds.includes(d.id) && !isOwner(d.headId)) recipients.add(d.headId);
        }
      }
      // ไม่เตือนคนมอบหมายงาน (19/10/2569 "ให้แจ้งเตือนกับคนที่มอบหมายงานไปให้พอ มันจะรกเกินไป")
      // แม้จะเป็นหัวหน้าแผนกของงานนั้นก็ตาม — ยกเว้นตัวเองก็เป็นผู้รับผิดชอบด้วย หรือเป็นงานส่วนตัว
      // ตั้งค่า notifyAssigner เดิมยังเก็บไว้ใน store แต่ไม่ใช้แล้ว
      if (!isPersonalTask(t) && !t.assigneeIds.includes(t.assignedById)) recipients.delete(t.assignedById);
      if (recipients.size === 0) continue;
      notifications.push({
        recipients: [...recipients],
        byUserId: SYSTEM_USER_ID,
        message: `งาน "${t.title}" ${latest.text}`,
        link: `/report-task/tasks?task=${t.id}`,
      });
    }
  }

  // ---- งานเสร็จแล้วแต่ค้าง "รอตรวจสอบ" ครบ 2 เดือน — เตือนคนที่เปิดงานให้ว่า "เสร็จแล้ว ปิดได้เลย" ----
  // (ผู้ใช้ขอ 20/10/2569 "ทำเสร็จหมดรอตรวจแต่ไม่กดผ่านไม่ผ่าน หรือลืม ... นับจากวันที่เสร็จ 2 เดือนให้ remind")
  // เตือนครั้งเดียวต่อรอบที่เสร็จ (key มี completedAt — ส่งกลับไปแก้แล้วเสร็จใหม่ = นับใหม่ เตือนใหม่ได้)
  // งานส่วนตัว / งานที่เปิดให้ตัวเอง ไม่เตือน · คนเดียวมีหลายชิ้นในรอบเดียว (เช่นวันแรกที่เปิดใช้) รวมเป็นแจ้งเตือนเดียว
  if (settings.task.enabled) {
    const nowMs = now().getTime();
    const staleByAssigner = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.status !== "done" || t.reviewedBy || !t.completedAt) continue;
      if (isPersonalTask(t) || !t.assignedById || t.assigneeIds.includes(t.assignedById)) continue;
      if (nowMs - new Date(t.completedAt).getTime() < REVIEW_STALE_DAYS * DAY_MINUTES * 60_000) continue;
      const key = `review-stale:${t.id}:${t.completedAt}`;
      if (alreadySent.has(key)) continue;
      newSentKeys.push(key);
      staleByAssigner.set(t.assignedById, [...(staleByAssigner.get(t.assignedById) ?? []), t]);
    }
    for (const [assignerId, list] of staleByAssigner) {
      if (list.length > REVIEW_STALE_GROUP_OVER) {
        notifications.push({
          recipients: [assignerId],
          byUserId: SYSTEM_USER_ID,
          message: `มีงาน ${list.length} ชิ้นที่ทำเสร็จเกิน 2 เดือนแล้ว ยังรอคุณตรวจ — กด ผ่าน / ไม่ผ่าน เพื่อปิดงานได้เลย`,
          link: "/report-task/tasks",
        });
        continue;
      }
      for (const t of list) {
        notifications.push({
          recipients: [assignerId],
          byUserId: SYSTEM_USER_ID,
          message: `งาน "${t.title}" ทำเสร็จตั้งแต่ ${formatThaiDay(t.completedAt!)} (เกิน 2 เดือนแล้ว) ยังรอคุณตรวจ — กด ผ่าน / ไม่ผ่าน เพื่อปิดงานได้เลย`,
          link: `/report-task/tasks?task=${t.id}`,
        });
      }
    }
  }

  // ---- Meetings: N minutes before start ----
  // 90 นาที → "1 ชม. 30 นาที", 1440 → "1 วัน" — ตั้งเตือนล่วงหน้าเป็นวันแล้วไม่ขึ้น "1440 นาที"
  const leadLabel = (lead: number) => {
    const min = Math.round(lead);
    if (min >= 1440 && min % 1440 === 0) return `${min / 1440} วัน`;
    if (min >= 60) return `${Math.floor(min / 60)} ชม.${min % 60 ? ` ${min % 60} นาที` : ""}`;
    return `${min} นาที`;
  };
  if (settings.meeting.enabled) {
    const nowMs = now().getTime();
    for (const m of meetings) {
      const minutesUntil = (new Date(m.start).getTime() - nowMs) / 60_000;
      if (minutesUntil < 0) continue; // already started
      // A meeting's own `reminderMinutes` (set at creation) wins over the
      // company-wide default — same "room override, company default"
      // relationship as `ReportTopic.remindBeforeCutoffMinutes` below.
      const leadOptions = m.reminderMinutes != null ? [m.reminderMinutes] : settings.meeting.leadMinutes;
      {
        const crossed = crossedLeads(leadOptions, minutesUntil);
        if (!claimLeads(crossed, (lead) => `meeting:${m.id}:${lead}`, alreadySent, newSentKeys)) continue;
        const lead = crossed[0]!;
        const recipients = settings.meeting.notifyAttendees
          ? m.attendeeIds?.length
            ? m.attendeeIds
            : m.createdById
              ? [m.createdById]
              : []
          : [];
        if (recipients.length === 0) continue;
        notifications.push({
          recipients,
          byUserId: SYSTEM_USER_ID,
          message: `ประชุม "${m.title}" เริ่มในอีก ${leadLabel(lead)}`,
          link: meetingLink(m.id),
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
    const pending = pendingToday(topics, posts, undefined, earlySubmitDays);
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
      // Whole-day leads (1440+, e.g. "1 วันก่อน") are handled by the
      // day-ahead block right below instead — a same-day countdown can't
      // express "the day before a Friday-only weekly round" since that round
      // isn't even due today. เตือนครั้งเดียวตามช่วงที่ใกล้สุด (ดู crossedLeads)
      const crossed = crossedLeads(
        leadOptions.filter((lead) => lead > 0 && lead < DAY_MINUTES),
        minutesUntilCutoff
      );
      if (crossed.length > 0) {
        if (settings.report.notifyPending) {
          for (const entry of entries) {
            if (!claimLeads(crossed, (lead) => `report:${groupKey}:${entry.userId}:${today}:${lead}`, alreadySent, newSentKeys)) continue;
            notifications.push({
              recipients: [entry.userId],
              byUserId: SYSTEM_USER_ID,
              message: `ยังไม่ได้ส่งรีพอต${roundPhrase} ห้อง "${topic.name}" วันนี้ ใกล้ถึงรอบตัดยอดแล้ว`,
              link: `/chat-report/report-feed?topic=${topic.id}`,
            });
          }
        }
        if (settings.report.notifyManagerSummary) {
          if (claimLeads(crossed, (lead) => `report-summary:${groupKey}:${today}:${lead}`, alreadySent, newSentKeys)) {
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
                link: `/chat-report/report-feed?topic=${topic.id}`,
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
          // ส่งล่วงหน้าไปแล้ว — ไม่ต้องเตือนคนนั้นอีก (หัวหน้าเห็นจำนวนเฉพาะคนที่ยังไม่ส่ง)
          const recipients = resolveRoundSubmitters(round, topic.visibility, groups).filter(
            (userId) => earlyPostsForRound(posts, topic.id, userId, round, targetDate, earlySubmitDays).length === 0
          );
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
                link: `/chat-report/report-feed?topic=${topic.id}`,
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
                  link: `/chat-report/report-feed?topic=${topic.id}`,
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
