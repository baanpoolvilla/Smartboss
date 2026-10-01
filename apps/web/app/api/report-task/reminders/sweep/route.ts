import { randomUUID } from "node:crypto";

import { requireOrg } from "@smartboss/auth";

import { createStoreIfAbsent, readStore, writeStore } from "@/modules/report_task/lib/db/org-store";
import { readTasks } from "@/modules/report_task/lib/db/task-repo";
import { computeReminders } from "@/modules/report_task/lib/reminder-sweep";
import { defaultReminderSettings, type ReminderSettings } from "@/modules/report_task/store/reminder-settings-store";
import type { ReportAlbum, ReportPost, ReportTopic, SubmitterGroup } from "@/modules/report_task/store/report-feed-store";
import type { AppNotification } from "@/modules/report_task/store/notification-store";
import type { CalendarEvent, TodoItem } from "@/modules/report_task/types";
import { claimSweep, releaseSweep } from "@/modules/report_task/lib/server/sweep-throttle";

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

async function sweep() {
  const session = await requireOrg();
  const orgId = session.orgId;

  const [{ data: settingsRaw }, { tasks }, { data: meetings }, { data: todos }, { data: reportFeed }] = await Promise.all([
    readStore<ReminderSettings>(orgId, SETTINGS_KEY),
    readTasks(orgId),
    readStore<CalendarEvent[]>(orgId, MEETINGS_KEY),
    readStore<TodoItem[]>(orgId, TODOS_KEY),
    readStore<{ topics: ReportTopic[]; posts: ReportPost[]; albums: ReportAlbum[]; submitterGroups?: SubmitterGroup[] }>(orgId, REPORT_FEED_KEY),
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
    submissionLock: { ...defaultReminderSettings.submissionLock, ...settingsRaw?.submissionLock },
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
    groups: reportFeed?.submitterGroups ?? [],
  });

  if (result.newSentKeys.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  const nextSentLog = [...result.newSentKeys, ...(sentLog ?? [])].slice(0, MAX_SENT_KEYS);
  // "จอง" ว่ารอบนี้เป็นคนส่ง — ทุกแท็บที่เปิดอยู่ (คอม + มือถือ) ยิง route นี้ทุก 60 วิ สองคำขอที่มาพร้อมกัน
  // อ่าน sent-log ชุดเดียวกัน คิดได้แจ้งเตือนชุดเดียวกัน เดิมไม่ดูผลการเขียน ⇒ ทั้งคู่ส่ง = แจ้งเตือนซ้ำ
  // ตอนนี้เขียนแบบตรวจ version: แพ้ (อีกคำขอเขียนไปก่อน) = ไม่ส่ง ให้คำขอนั้นส่งไปแล้ว
  // ยังไม่เคยมีแถว (version 0) — writeStore ตอนนั้นเป็น upsert ไม่ตรวจ version ใช้สร้างแบบใครมาก่อนชนะแทน
  const claimed =
    sentVersion === 0
      ? await createStoreIfAbsent(orgId, SENT_LOG_KEY, nextSentLog, session.userId)
      : await writeStore(orgId, SENT_LOG_KEY, nextSentLog, sentVersion, session.userId);
  if (!claimed.ok) return Response.json({ ok: true, sent: 0, raced: true });

  if (result.notifications.length > 0) {
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
    // ก้อนแจ้งเตือนมีคนเขียนตลอด (กดอ่าน, คอมเมนต์ ฯลฯ) — ชนแล้วอ่านใหม่ต่อท้ายใหม่ ไม่ทิ้งแจ้งเตือนที่จองไว้แล้ว
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing, version: v } = await readStore<AppNotification[]>(orgId, NOTIFICATIONS_KEY);
      const written = await writeStore(orgId, NOTIFICATIONS_KEY, [...fresh, ...(existing ?? [])], v, session.userId);
      if (written.ok) break;
    }
  }

  return Response.json({ ok: true, sent: result.notifications.length });
}

// เผื่ออนาคตต่อ cron ได้ (ต้องแก้ requireOrg ให้รับ secret ก่อน — ดูคอมเมนต์บนสุด)
export async function GET() {
  return POST();
}

export async function POST() {
  const session = await requireOrg();
  // ทุกแท็บสั่งทุก 60 วิ — รันจริงไม่เกิน 1 ครั้ง/30 วิ/บริษัท (ดู sweep-throttle.ts)
  if (!claimSweep("reminders", session.orgId)) return Response.json({ ok: true, sent: 0, throttled: true });
  try {
    return await sweep();
  } finally {
    releaseSweep("reminders", session.orgId);
  }
}
