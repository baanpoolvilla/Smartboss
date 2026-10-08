import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { withWorkforceTenant } from "@/modules/report_task/lib/db/workforce-calendar";
import { broadcastToChannel } from "@/modules/chat/data/channels";
import { notifyUser } from "@/modules/maintenance/data/notify";
import { hydrateMessages } from "@/modules/chat/data/serialize";
import { CLOCK_CHANNEL_PREFIX } from "@/modules/chat/types";
import { CARRY_OVER_HOURS } from "@/modules/hr/lib/clock-state";
import { eventSourceLabel } from "@/modules/hr/lib/labels";
import { WORKFORCE_API_BASE } from "@/modules/hr/lib/api";
import { bangkokDay, workforceReadToken } from "@/lib/attendance-recalc";

/**
 * เด้งเวลาเข้า/ออกงานเข้าแชท — ห้องส่วนตัว "🕐 ระบบลงเวลา" ของแต่ละคน เห็นแค่เวลาของตัวเอง
 * (เจ้าของงานเลือก 2026-10-07) ทั้งสแกนนิ้วและกดในแอป/LINE
 *
 * รันจาก cron ทุกนาที (?task=attendance-chat — ดู docs/deploy.md) ⇒ ข้อความช้ากว่าเวลาจริงไม่เกิน ~1 นาที
 * ไม่ต้องเพิ่มตาราง/คอลัมน์:
 *   - ห้อง id คงที่ `clock-<userId>` (แบบเดียวกับห้องรวม `org-<orgId>`) ⇒ "หาหรือสร้าง" เป็น upsert
 *   - ข้อความ id = `clk-<raw_time_event_id>` ⇒ รันซ้ำ/สองรอบชนกัน ข้อความไม่ซ้ำ (insert ซ้ำ = P2002 ข้าม)
 *
 * ดูย้อนหลังแค่ช่วงสั้น (เหตุการณ์ที่ระบบรับเข้ามาภายใน RECENT_HOURS) — เปิดใช้ครั้งแรกจะไม่ไล่เทประวัติ
 * ทั้งหมดเข้าแชท และถ้า cron หยุดไปนานกว่านั้น รายการช่วงนั้นข้ามไป (ดูย้อนได้ที่หน้าการลงเวลาเสมอ)
 */

const CHANNEL_NAME = "🕐 ระบบลงเวลา";
/** โพสต์เฉพาะเหตุการณ์ที่ระบบรับเข้ามาภายในกี่ชั่วโมง (เครื่องสแกนที่ออฟไลน์แล้วส่งย้อนหลังยังทัน) */
const RECENT_HOURS = 3;
/** อ่านย้อนเพื่อรู้ว่ารายการไหนคือเข้า/ออก (สแกนนิ้วไม่บอก) — ต้องครอบกะข้ามคืน */
const LOOKBACK_HOURS = 36;

export function clockChannelId(userId: string): string {
  return `${CLOCK_CHANNEL_PREFIX}${userId}`;
}

/**
 * ผู้เขียนข้อความในห้องระบบลงเวลา — ไม่ใช่ตัวพนักงานเอง ไม่งั้นข้อความถูกนับว่า "ตัวเองเขียน" แล้วไม่ขึ้น
 * ตัวเลขยังไม่อ่าน (author_id ไม่มี FK ไปที่ผู้ใช้ — ข้อความ kind system ไม่โชว์ชื่อผู้เขียนอยู่แล้ว)
 */
const CLOCK_AUTHOR = "system:clock";

interface EventRow {
  id: string;
  user_id: string | null;
  employment_id: string;
  captured_at: Date;
  received_at: Date;
  event_intent: string;
  source_type: string;
  requires_review: boolean | null;
}

function hhmm(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(d);
}

function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short" }).format(d);
}

function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

/**
 * ตีความทีละรายการว่าเป็นเข้า/ออก — กติกาเดียวกับ modules/hr/lib/clock-state.ts:
 * CLOCK_IN/CLOCK_OUT ตามที่กด · สแกนนิ้ว (AUTO) = สลับสถานะ · เข้าค้างไว้นานเกิน CARRY_OVER_HOURS = ลืมออก
 */
function describe(events: EventRow[], lateOf: (e: EventRow) => number): Map<string, string> {
  const out = new Map<string, string>();
  let openedAt: Date | null = null;
  for (const e of events) {
    if (openedAt && e.captured_at.getTime() - openedAt.getTime() > CARRY_OVER_HOURS * 3_600_000) openedAt = null;
    const source = eventSourceLabel(e.source_type);
    const review = e.requires_review ? " · รอ HR ตรวจ" : "";
    const isIn = e.event_intent === "CLOCK_IN" || (e.event_intent === "AUTO" && openedAt === null);
    const isOut = e.event_intent === "CLOCK_OUT" || (e.event_intent === "AUTO" && openedAt !== null);
    if (isIn) {
      const late = lateOf(e);
      out.set(
        e.id,
        late > 0
          ? `⚠️ ${dayLabel(e.captured_at)} · เข้างาน ${hhmm(e.captured_at)} · สาย ${late} นาที${source ? ` · ${source}` : ""}${review}`
          : `✅ ${dayLabel(e.captured_at)} · เข้างาน ${hhmm(e.captured_at)}${source ? ` · ${source}` : ""}${review}`,
      );
      openedAt = e.captured_at;
    } else if (isOut) {
      const worked = openedAt ? ` · วันนี้ทำงาน ${duration(e.captured_at.getTime() - openedAt.getTime())}` : "";
      out.set(e.id, `🏁 ${dayLabel(e.captured_at)} · ออกงาน ${hhmm(e.captured_at)}${worked}${source ? ` · ${source}` : ""}${review}`);
      openedAt = null;
    } else if (e.event_intent === "BREAK_START") {
      out.set(e.id, `☕ เริ่มพัก ${hhmm(e.captured_at)}`);
    } else if (e.event_intent === "BREAK_END") {
      out.set(e.id, `↩️ กลับจากพัก ${hhmm(e.captured_at)}`);
    }
  }
  return out;
}

function bangkokDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}

/**
 * สายกี่นาทีของวันนี้ ต่อ employment — จากกระดานลงเวลาของระบบบุคคล (/time-event-board) ตัวเดียวกับ
 * หน้าการลงเวลาของ HR: สแกนครั้งแรกของวัน เทียบเวลาเข้ากะ หักผ่อนผันตามนโยบายแล้ว
 * ดึงเฉพาะรอบที่มี "เข้า" ใหม่ของวันนี้ (ส่วนใหญ่ช่วงเช้า) — อ่านไม่ได้ = ไม่บอกสาย ข้อความเข้างานยังเด้งตามปกติ
 */
async function lateToday(
  orgId: string,
  rows: EventRow[],
  recentFrom: number,
): Promise<Map<string, { firstAt: number; minutes: number }>> {
  const today = bangkokDay(0);
  const hasFreshToday = rows.some((r) => r.received_at.getTime() >= recentFrom && bangkokDate(r.captured_at) === today);
  if (!hasFreshToday) return new Map();
  const token = await workforceReadToken(orgId);
  if (!token) return new Map();
  try {
    const res = await fetch(`${WORKFORCE_API_BASE}/time-event-board?date=${today}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return new Map();
    const board = (await res.json()) as {
      items: { employment_id: string; first_scan_at: string; status: string; late_minutes: number }[];
    };
    return new Map(
      board.items
        .filter((i) => i.status === "LATE" && i.late_minutes > 0)
        .map((i) => [i.employment_id, { firstAt: new Date(i.first_scan_at).getTime(), minutes: i.late_minutes }]),
    );
  } catch {
    return new Map();
  }
}

const ensured = globalThis as unknown as { __clockChannels?: Set<string> };
const ensuredChannels = (ensured.__clockChannels ??= new Set<string>());

/** ห้อง "ระบบลงเวลา" ของคนนี้ — สมาชิกคนเดียวคือเจ้าตัว */
async function ensureClockChannel(orgId: string, userId: string): Promise<string> {
  const id = clockChannelId(userId);
  if (!ensuredChannels.has(id)) {
    await prisma.chatChannel.upsert({
      where: { id },
      update: { archived: false },
      create: { id, orgId, type: "group", name: CHANNEL_NAME, createdById: userId },
    });
    ensuredChannels.add(id);
  }
  // ทุกครั้งที่มีของใหม่ (ไม่ใช่ทุกนาที) — กดออกจากห้องไปแล้ว ข้อความถัดไปก็กลับเข้าห้องเอง
  await prisma.chatChannelMember.createMany({
    data: [{ channelId: id, userId, orgId, role: "member" }],
    skipDuplicates: true,
  });
  return id;
}

async function postForOrg(orgId: string): Promise<number> {
  const rows = await withWorkforceTenant(orgId, (tx) =>
    tx.$queryRaw<EventRow[]>`
      SELECT e.id, p.subject AS user_id, e.employment_id, e.captured_at, e.received_at,
             e.event_intent, e.source_type, (e.evidence->>'requires_review')::boolean AS requires_review
      FROM workforce.raw_time_events e
      JOIN workforce.employments em ON em.id = e.employment_id
      JOIN workforce.principals  p  ON p.person_id = em.person_id
      WHERE e.status = 'ACCEPTED'
        AND e.captured_at >= now() - make_interval(hours => ${LOOKBACK_HOURS}::int)
        -- HR กด "ไม่นับรายการนี้" = เหมือนไม่เคยลง (ตรงกับตัวคิดชั่วโมงและกระดานของระบบบุคคล)
        AND NOT EXISTS (
          SELECT 1 FROM workforce.mobile_risk_assessments ra
          WHERE ra.raw_time_event_id = e.id AND ra.review_outcome = 'REJECTED'
        )
      ORDER BY e.captured_at
      LIMIT 20000
    `
  );
  if (rows.length === 0) return 0;

  const recentFrom = Date.now() - RECENT_HOURS * 3_600_000;
  const byUser = new Map<string, EventRow[]>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  const lateByEmployment = await lateToday(orgId, rows, recentFrom);
  const today = bangkokDay(0);
  // สายนับเฉพาะ "เข้าครั้งแรกของวันนี้" — ตัวเลขเดียวกับป้าย "สาย" ในหน้าการลงเวลาของ HR
  const lateOf = (e: EventRow): number => {
    const late = lateByEmployment.get(e.employment_id);
    if (!late || bangkokDate(e.captured_at) !== today) return 0;
    return late.firstAt === e.captured_at.getTime() ? late.minutes : 0;
  };

  // เฉพาะคนที่เป็นผู้ใช้ของบริษัทนี้จริงและยังใช้งานอยู่
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true, id: { in: [...byUser.keys()] } },
    select: { id: true },
  });
  const activeIds = new Set(users.map((u) => u.id));

  let posted = 0;
  for (const [userId, events] of byUser) {
    if (!activeIds.has(userId)) continue;
    const recent = events.filter((e) => e.received_at.getTime() >= recentFrom);
    if (recent.length === 0) continue;

    // ข้ามที่โพสต์ไปแล้ว ก่อนจะแตะห้อง (รอบปกติส่วนใหญ่ไม่มีอะไรใหม่)
    const ids = recent.map((e) => `clk-${e.id}`);
    const existing = new Set(
      (await prisma.chatMessage.findMany({ where: { orgId, id: { in: ids } }, select: { id: true } })).map((m) => m.id)
    );
    const fresh = recent.filter((e) => !existing.has(`clk-${e.id}`));
    if (fresh.length === 0) continue;

    const text = describe(events, lateOf);
    const channelId = await ensureClockChannel(orgId, userId);
    for (const e of fresh) {
      const body = text.get(e.id);
      if (!body) continue;
      try {
        const row = await prisma.chatMessage.create({
          data: { id: `clk-${e.id}`, orgId, channelId, authorId: CLOCK_AUTHOR, kind: "system", body },
        });
        const [message] = await hydrateMessages(orgId, [row]);
        await broadcastToChannel(orgId, channelId, { type: "chat.message", channelId, message: message! }, [userId]);
        // ลงกระดิ่งด้วย (+ เด้ง/Web Push ผ่าน notifyUser) — แชททั่วไปไม่ลงกระดิ่ง (chat/data/notify.ts)
        // แต่เข้า/ออกงานเป็นเรื่องของเจ้าตัวโดยตรง ("ทำไมไม่ขึ้นแจ้งเตือนบอกด้วยว่ามีข้อความนี้เข้ามาในกระดิ่ง")
        await notifyUser(orgId, userId, { title: CHANNEL_NAME, body, type: "hr_clock_event", referenceId: channelId });
        posted++;
      } catch (error) {
        // อีกรอบโพสต์ไปก่อนแล้ว — ปกติ ไม่ใช่ข้อผิดพลาด
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
  }
  return posted;
}

export async function postAttendanceToChat(): Promise<{ orgs: number; posted: number; failed: number }> {
  const orgs = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.organization.findMany({ select: { id: true } })
  );
  let posted = 0;
  let failed = 0;
  for (const org of orgs) {
    try {
      posted += await postForOrg(org.id);
    } catch (error) {
      // บริษัทที่ยังไม่เปิดระบบบุคคล / ข้อมูลพังรายเดียว ต้องไม่ทำให้บริษัทอื่นไม่ได้ข้อความ
      failed++;
      console.error("[attendance-chat] org failed", org.id, error);
    }
  }
  return { orgs: orgs.length, posted, failed };
}

/** ข้อความเรื่องลงเวลาที่ไม่ได้มาจากการสแกน (เช่น HR ไม่นับรายการ) — ลงห้อง "ระบบลงเวลา" ของคนนั้น */
export async function postClockNotice(orgId: string, userId: string, body: string): Promise<void> {
  const channelId = await ensureClockChannel(orgId, userId);
  const row = await prisma.chatMessage.create({ data: { orgId, channelId, authorId: CLOCK_AUTHOR, kind: "system", body } });
  const [message] = await hydrateMessages(orgId, [row]);
  await broadcastToChannel(orgId, channelId, { type: "chat.message", channelId, message: message! }, [userId]);
}
