import "server-only";

import { prisma } from "@smartboss/database";

import { loadPerformanceSettings } from "@/lib/performance";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { readStoreCached } from "@/modules/report_task/lib/db/store-cached-read";
import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";

/**
 * "มีอะไรที่ตัวหักคะแนนรายงานใช้ เปลี่ยนไปไหม" — ให้ reports/sweep รู้ว่าต้องรันทันที หรือเว้นไปได้
 * (ผู้ใช้ 8/11/2569: ให้หักคะแนนเร็วเท่าเดิม แต่ไม่ต้องรันซ้ำทุก 30 วิตอนไม่มีอะไรเกิดขึ้น)
 *
 * ครอบคลุมทุกอย่างที่ report-penalty-sweep-run.ts อ่าน:
 *   ฟีด (โพสต์/ห้อง/กลุ่มผู้ส่ง — ไม่นับการอ่าน ตอบ สติกเกอร์) · ตั้งค่าของห้องรายงานทุกคีย์ · คำร้องแก้คะแนน
 *   รอบเกรด · ตั้งค่าคะแนนของบริษัท · ใบลา/OT/วันหยุดในระบบบุคคล
 * อีกอย่างที่เปลี่ยนเองตามเวลา (ไม่มีใครแก้อะไร) = เลยเวลาปิดรอบ/ปิดรับ/เที่ยงคืน → crossedClockBoundary
 */

type FeedLike = { topics?: unknown[]; submitterGroups?: unknown[]; posts?: Record<string, unknown>[] };

// ช่องของโพสต์ที่เปลี่ยนจากการอ่าน/ตอบ/กดสติกเกอร์เท่านั้น — ไม่มีผลกับการตัดสินส่ง/สาย/พลาด
const SOCIAL_FIELDS = new Set(["replies", "unreadFor", "savedBy", "reactions", "stickerReactions", "pinned", "readBy"]);

// คีย์ตั้งค่า/ข้อมูลที่ตัวหักคะแนนอ่าน (นอกจากฟีด)
const SETTING_KEYS = [
  "report-penalty-settings",
  "report-penalty-enabled-since",
  "report-penalty-grace-days",
  "report-early-submit-days",
  "report-penalty-requests",
  "routine-dayoff",
  "reminder-settings",
  "score-period",
];

const g = globalThis as unknown as { __reportSweepFeedKey?: Map<string, { version: number; key: string; times: string[] }> };
const feedKeys = (g.__reportSweepFeedKey ??= new Map());

function hashOf(parts: Iterable<string>): string {
  let h = 2166136261;
  for (const str of parts) {
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x7c, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** ส่วนของฟีด — คิดใหม่เฉพาะเมื่อเวอร์ชันฟีดเปลี่ยน (ฟีดอ่านจากหน่วยความจำ) + เวลาปิดรอบทุกค่าที่เจอในห้อง */
async function feedPart(orgId: string): Promise<{ key: string; times: string[] }> {
  const { data, version } = await readStoreCached<FeedLike>(orgId, "report-feed");
  const hit = feedKeys.get(orgId);
  if (hit && hit.version === version) return hit;
  const topicsJson = JSON.stringify(data?.topics ?? []);
  const parts = function* () {
    yield topicsJson;
    yield JSON.stringify(data?.submitterGroups ?? []);
    for (const p of data?.posts ?? []) yield JSON.stringify(p, (k, v) => (SOCIAL_FIELDS.has(k) ? undefined : v));
  };
  // เวลาปิดรอบ (round.time) / ปิดรับ (hardCutoffTime) / รอบแบบเก่า (cutoffs) — ทุกค่า "HH:mm" ในตั้งค่าห้อง
  const times = [...new Set(topicsJson.match(/"\d{2}:\d{2}"/g)?.map((s) => s.slice(1, -1)) ?? [])];
  const entry = { version, key: `${data?.posts?.length ?? 0}.${hashOf(parts())}`, times };
  feedKeys.set(orgId, entry);
  return entry;
}

/** ลายนิ้วมือของทุกอย่างที่ตัวหักคะแนนใช้ — เปลี่ยน = ต้องรันใหม่ · คืนเวลาปิดรอบไว้ใช้กับ crossedClockBoundary ด้วย */
export async function reportSweepInputs(orgId: string): Promise<{ key: string; times: string[] }> {
  const [feed, stores, perf, hr] = await Promise.all([
    feedPart(orgId),
    prisma.reportTaskStore.findMany({ where: { orgId, key: { in: SETTING_KEYS } }, select: { key: true, version: true } }),
    loadPerformanceSettings(orgId),
    // นับ + ผลรวมเวอร์ชัน + แก้ล่าสุด — อนุมัติ/ยกเลิก/แก้ใบไหนก็ขยับ (ย้อนดู 60 วันพอ — ตัวหักคะแนนดู 45 วัน)
    withWorkforceTenant(orgId, (tx) =>
      tx.$queryRaw<{ l: string; o: string; h: string }[]>`
        SELECT
          (SELECT count(*) || ':' || coalesce(sum(version), 0) || ':' || coalesce(max(updated_at)::text, '')
             FROM workforce.leave_requests WHERE ends_on >= current_date - 60) AS l,
          (SELECT count(*) || ':' || coalesce(sum(version), 0) || ':' || coalesce(max(updated_at)::text, '')
             FROM workforce.overtime_requests WHERE work_date >= current_date - 60) AS o,
          (SELECT count(*) || ':' || coalesce(max(created_at)::text, '')
             FROM workforce.holiday_dates WHERE holiday_date >= current_date - 60) AS h
      `
    ),
  ]);
  const { data: reminder } = await readStore<{ submissionLock?: { time?: string } }>(orgId, "reminder-settings");
  const times = [...feed.times];
  if (reminder?.submissionLock?.time) times.push(reminder.submissionLock.time);
  const storePart = stores
    .map((s) => `${s.key}=${s.version}`)
    .sort()
    .join(",");
  const key = [feed.key, storePart, hashOf([JSON.stringify(perf)]), JSON.stringify(hr[0] ?? {})].join("|");
  return { key, times };
}

/**
 * ระหว่าง since ถึง now ผ่านเวลาที่ผลอาจเปลี่ยนเองไหม — เวลาปิดรอบ/ปิดรับของห้องใดห้องหนึ่ง หรือเที่ยงคืน (ขึ้นวันใหม่
 * = วันก่อนจบ ตัดสิน "ไม่ส่ง" ได้ · ช่วงเผื่อส่งรายสัปดาห์/เดือนหมดตอนขึ้นวัน) · เวลาเครื่อง = Asia/Bangkok (systemd TZ)
 */
export function crossedClockBoundary(times: string[], sinceMs: number, nowMs: number = Date.now()): boolean {
  const all = new Set([...times, "00:00"]);
  const day = new Date(sinceMs);
  day.setHours(0, 0, 0, 0);
  for (let d = day.getTime(); d <= nowMs; d += 86_400_000) {
    for (const t of all) {
      const [h, m] = t.split(":").map(Number) as [number, number];
      if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) continue;
      const at = new Date(d);
      at.setHours(h, m, 0, 0);
      const ms = at.getTime();
      // +1 วิ: ตัวตัดสินใช้ "นาทีปัจจุบัน ≥ เวลาปิด" — ถึงนาทีนั้นพอดีก็นับว่าเลยแล้ว
      if (ms > sinceMs && ms + 1000 <= nowMs) return true;
    }
  }
  return false;
}
