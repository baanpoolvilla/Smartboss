import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@smartboss/database";

import { recordPerformanceEvents, type PerformanceEventInput } from "@/lib/performance";
import { findChannel, findEmployeeId } from "@/modules/report_task/lib/discord/config";
import { decide, toThaiLocal } from "@/modules/report_task/lib/discord/decider";
import { getRosterState } from "@/modules/report_task/lib/discord/working-days";

/**
 * รับข้อมูลดิบจาก Discord bot แล้ว "ตัดสินเอง" ตามเกณฑ์หน้า report × roster ของ HR
 * — ดู docs/discord_report_integration.md
 *
 * auth: header x-discord-sync-key ต้องตรงกับ env DISCORD_SYNC_SECRET (แพตเทิร์น
 * เดียวกับ legacy attendance ingest) · org มาจากการ map ห้อง ไม่รับจาก client
 */
export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  discordChannelId: z.string().min(1),
  discordUserId: z.string().min(1),
  messageId: z.string().min(1),
  postedAt: z.string().datetime({ offset: true }),
  content: z.string().default(""),
  imageCount: z.number().int().min(0).default(0),
});
const BodySchema = z.object({ messages: z.array(MessageSchema).min(1).max(200) });

function requiredWeekdayOk(weekdays: number[], reportDate: string): boolean {
  if (weekdays.length === 0) return true;
  const day = new Date(`${reportDate}T00:00:00Z`).getUTCDay();
  return weekdays.includes(day);
}

export async function POST(req: Request) {
  const secret = process.env.DISCORD_SYNC_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "DISCORD_SYNC_SECRET ไม่ได้ตั้งค่า" }, { status: 503 });
  }
  if (req.headers.get("x-discord-sync-key") !== secret) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "payload ไม่ถูกต้อง" }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];
  const dockEvents: PerformanceEventInput[] = [];

  for (const m of body.messages) {
    const ch = await findChannel(m.discordChannelId);
    if (!ch || !ch.active) {
      results.push({ messageId: m.messageId, skipped: "channel-not-tracked" });
      continue;
    }
    if (ch.keywordOnly && !m.content.toLowerCase().includes(ch.keyword.toLowerCase())) {
      results.push({ messageId: m.messageId, skipped: "no-keyword" });
      continue;
    }

    const employeeId = await findEmployeeId(ch.orgId, m.discordUserId);
    const { date: reportDate } = toThaiLocal(m.postedAt);

    // "วันนี้ต้องส่งไหม" — ยึด roster ของ HR ถ้าเปิดไว้ (fallback เป็น requiredWeekdays เมื่อไม่มีข้อมูล)
    let mustReport: boolean;
    if (employeeId && ch.useRoster) {
      const state = await getRosterState(employeeId, reportDate);
      mustReport = state === null ? requiredWeekdayOk(ch.requiredWeekdays, reportDate) : state === "WORKING";
    } else {
      mustReport = requiredWeekdayOk(ch.requiredWeekdays, reportDate);
    }

    const decision = decide({
      postedAtIso: m.postedAt,
      imageCount: m.imageCount,
      rule: { topicId: ch.topicId, rounds: ch.rounds, minImages: ch.minImages },
      mustReport,
    });

    // เก็บดิบ (idempotent ด้วย messageId) — ยิงซ้ำ = อัปเดตผลล่าสุด
    await prisma.reportSubmission.upsert({
      where: { orgId_messageId: { orgId: ch.orgId, messageId: m.messageId } },
      create: {
        orgId: ch.orgId,
        id: randomUUID(),
        employeeId,
        discordUserId: m.discordUserId,
        channelId: ch.discordChannelId,
        topicId: ch.topicId,
        roundId: decision.roundId,
        reportDate: new Date(reportDate),
        postedAt: new Date(m.postedAt),
        messageId: m.messageId,
        imageCount: m.imageCount,
        content: m.content.slice(0, 4000),
        status: decision.status,
      },
      update: {
        employeeId,
        roundId: decision.roundId,
        reportDate: new Date(reportDate),
        postedAt: new Date(m.postedAt),
        imageCount: m.imageCount,
        content: m.content.slice(0, 4000),
        status: decision.status,
      },
    });

    // หักคะแนนเฉพาะ "สาย" — กันซ้ำด้วย refId รายรอบ (ยิงซ้ำไม่หักซ้ำ)
    if (employeeId && decision.shouldDock) {
      dockEvents.push({
        orgId: ch.orgId,
        userId: employeeId,
        source: "report_task",
        category: "report_late",
        occurredAt: new Date(reportDate),
        refType: "report_round",
        refId: `${reportDate}:${ch.topicId}:${decision.roundId}:${employeeId}`,
        note: "จาก Discord",
      });
    }

    results.push({
      messageId: m.messageId,
      employeeId: employeeId ?? null,
      status: decision.status,
      round: decision.roundId,
      reportDate,
    });
  }

  const docked = await recordPerformanceEvents(dockEvents);
  return Response.json({ ok: true, processed: results.length, docked, results });
}
