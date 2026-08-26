import { randomUUID } from "node:crypto";

import { requireOrg } from "@smartboss/auth";

import { readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { readTasks } from "@/modules/report_task/lib/db/task-repo";
import { computeReminders } from "@/modules/report_task/lib/reminder-sweep";
import { defaultReminderSettings, type ReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { ReportAlbum, ReportPost, ReportTopic } from "@/modules/report_task/store/report-feed-store";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { CalendarEvent, TodoItem } from "@/modules/report_task/types";

/**
 * แจ้งเตือน "ใกล้ถึงกำหนด" (งาน/ประชุม/รอบส่งรีพอต) — คนละงานกับ
 * tasks/sweep (ที่หักคะแนนงานที่ "เลยกำหนดไปแล้ว") ไฟล์นี้มองไปข้างหน้า
 * ไม่ใช่ย้อนหลัง จึงแยก route ต่างหากแทนที่จะยัดเข้า sweep เดิม
 *
 * เรียกจากฝั่ง client เหมือน tasks/sweep เป๊ะๆ (ดู task-sync.tsx) — ทริกเกอร์
 * ทุก 60 วิระหว่างมีแท็บเปิดอยู่ ไม่ได้อยู่ใน vercel.json cron เพราะ
 * requireOrg() ต้องมี session ผู้ใช้จริง ยิงจาก Vercel Cron ตรงๆ ไม่ได้ —
 * ข้อจำกัดเดียวกับ tasks/sweep ทุกประการ (ดูคอมเมนต์ที่นั่น)
 */
export const dynamic = "force-dynamic";

const SETTINGS_KEY = "reminder-settings";
const SENT_LOG_KEY = "reminder-sent-log";
const NOTIFICATIONS_KEY = "notifications";
const MEETINGS_KEY = "meetings";
const TODOS_KEY = "todos";
const REPORT_FEED_KEY = "report-feed";
// Dedup keys accumulate roughly one per (task × lead-day) and (person × room
// × day × lead) — capped so a company running this for years doesn't grow
// the row unbounded. Old keys aging out just means a years-old task/day
// could theoretically re-notify, which never happens in practice since the
// underlying task/day is long gone by then anyway.
const MAX_SENT_KEYS = 20_000;

export async function POST() {
  const session = await requireOrg();
  const orgId = session.orgId;

  const [{ data: settingsRaw }, { tasks }, { data: meetings }, { data: todos }, { data: reportFeed }] = await Promise.all([
    readStore<ReminderSettings>(orgId, SETTINGS_KEY),
    readTasks(orgId),
    readStore<CalendarEvent[]>(orgId, MEETINGS_KEY),
    readStore<TodoItem[]>(orgId, TODOS_KEY),
    readStore<{ topics: ReportTopic[]; posts: ReportPost[]; albums: ReportAlbum[] }>(orgId, REPORT_FEED_KEY),
  ]);
  // Merged field-by-field, not a plain `?? default` — a row saved before
  // `task.leadMinutes`/`todo` existed on ReminderSettings only has the old
  // shape (`task.leadDays`, no `todo` key at all), and computeReminders reads
  // `settings.task.leadMinutes.length`/`settings.todo.enabled` unconditionally.
  // That combination 500'd this route on every org still on old data — the
  // client store already migrates the same way (store-hydrator.tsx), this
  // route just never went through it since it reads the DB directly.
  const rawTask = settingsRaw?.task as (Partial<ReminderSettings["task"]> & { leadDays?: number[] }) | undefined;
  const migratedLeadMinutes = rawTask?.leadMinutes ?? rawTask?.leadDays?.map((d) => d * 1440);
  const settings: ReminderSettings = {
    task: { ...defaultReminderSettings.task, ...rawTask, ...(migratedLeadMinutes ? { leadMinutes: migratedLeadMinutes } : {}) },
    meeting: { ...defaultReminderSettings.meeting, ...settingsRaw?.meeting },
    report: { ...defaultReminderSettings.report, ...settingsRaw?.report },
    todo: { ...defaultReminderSettings.todo, ...settingsRaw?.todo },
  };

  const { data: sentLog, version: sentVersion } = await readStore<string[]>(orgId, SENT_LOG_KEY);
  const alreadySent = new Set(sentLog ?? []);

  const result = computeReminders({
    tasks,
    meetings: meetings ?? [],
    todos: todos ?? [],
    topics: reportFeed?.topics ?? [],
    posts: reportFeed?.posts ?? [],
    settings,
    alreadySent,
  });

  if (result.newSentKeys.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  const nextSentLog = [...result.newSentKeys, ...(sentLog ?? [])].slice(0, MAX_SENT_KEYS);
  await writeStore(orgId, SENT_LOG_KEY, nextSentLog, sentVersion, session.userId);

  if (result.notifications.length > 0) {
    const { data: existing, version: v } = await readStore<AppNotification[]>(orgId, NOTIFICATIONS_KEY);
    const fresh: AppNotification[] = result.notifications.flatMap((n) =>
      n.recipients.map((userId) => ({
        id: `notif-${randomUUID()}`,
        userId,
        byUserId: n.byUserId,
        message: n.message,
        link: n.link,
        createdAt: new Date().toISOString(),
        read: false,
      }))
    );
    await writeStore(orgId, NOTIFICATIONS_KEY, [...fresh, ...(existing ?? [])], v, session.userId);
  }

  return Response.json({ ok: true, sent: result.notifications.length });
}

// เผื่ออนาคตต่อ cron ได้ (ต้องแก้ requireOrg ให้รับ secret ก่อน — ดูคอมเมนต์บนสุด)
export async function GET() {
  return POST();
}
