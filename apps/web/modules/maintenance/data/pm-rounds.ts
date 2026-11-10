import { workOrderMemberIds } from "@/modules/maintenance/lib/work-order-members";
import "server-only";
import { roundOrderTeam } from "@/modules/maintenance/lib/pm-team";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { nextWorkOrderCode } from "@/lib/document-code";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { logActivity } from "@/modules/maintenance/data/activity";
import { deleteNotificationsByReference, notifyUser } from "@/modules/maintenance/data/notify";
import { postWorkOrderCard } from "@/modules/chat/data/task-cards";
import {
  dueRounds,
  nextRound,
  PILEUP_MIN_ROUNDS,
  pmUsesRounds,
  roundDueAt,
  roundDockRefId,
  roundDockWorkOrderId,
  roundDescLine,
  roundModeOn,
  todayBkkDate,
  upcomingRounds,
  windowTransition,
  ymd,
  type RoundOrg,
} from "@/modules/maintenance/lib/pm-rounds";

/** PM แบบนับรอบ — ฝั่งฐานข้อมูล (กติกาอยู่ที่ lib/pm-rounds.ts) */

/** บริษัทที่เปิดใช้ PM แบบนับรอบแล้ว (ถึงวันเริ่มแล้ว) */
export async function loadRoundOrgs(): Promise<Map<string, RoundOrg>> {
  const rows = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.performanceSetting.findMany({
      where: { pmRoundsFrom: { not: null } },
      select: { orgId: true, pmRoundsFrom: true, pmLeadDays: true },
    }),
  );
  const today = todayBkkDate();
  const out = new Map<string, RoundOrg>();
  for (const r of rows) if (roundModeOn(r, today)) out.set(r.orgId, r);
  return out;
}

/** การตั้งค่าแบบนับรอบของบริษัทเดียว — ใช้ใน server action (ไม่ใช่ cron) */
export async function loadRoundOrg(orgId: string): Promise<RoundOrg | undefined> {
  const r = await prisma.performanceSetting.findUnique({
    where: { orgId },
    select: { pmRoundsFrom: true, pmLeadDays: true },
  });
  return r && roundModeOn(r) ? r : undefined;
}

/** แผน PM นี้เดินแบบนับรอบไหม (บริษัทเปิดใช้ + ไม่ใช่แผนนับครั้ง) */
export async function pmIsRoundMode(orgId: string, pm: { totalRounds: number | null }): Promise<boolean> {
  return pmUsesRounds(await loadRoundOrg(orgId), pm);
}

const OPEN = ["open", "in_progress"];

/**
 * เปิดใบงานของรอบที่ถึงเวลา (ก่อนครบกำหนด leadDays วัน) — ใบรอบเก่ายังค้างก็เปิดรอบใหม่ซ้อนได้
 * ใบที่เปิดค้างอยู่แต่ยังไม่มีรอบ (ใบอัตโนมัติก่อนเปิดใช้ / คนเปิดเองจากหน้า PM) = ใบของรอบแรกที่ถึง
 * รอบที่ครบกำหนดก่อนวันเริ่มใช้ ไม่เปิดใบย้อนหลัง
 */
export async function generateRoundWorkOrders(orgs: Map<string, RoundOrg>, pmIds?: string[]): Promise<{ created: number }> {
  if (orgs.size === 0) return { created: 0 };
  // ใบที่ค้างจากกติกาเดิม (เปิดก่อนวัน) ปรับก่อนเปิดรอบใหม่ — ใบที่ปิดไปจะถูกเปิดใหม่ในลูปข้างล่างเมื่อถึงวัน
  await applyWindowTransition(orgs, pmIds);
  const pms = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.pmSchedule.findMany({
      where: { orgId: { in: [...orgs.keys()] }, ...(pmIds ? { id: { in: pmIds } } : {}), isActive: true, awaitingSchedule: false, totalRounds: null },
      include: { property: { select: { caretakerId: true } } },
    }),
  );

  let created = 0;
  for (const pm of pms) {
    const st = orgs.get(pm.orgId);
    if (!st || !pmUsesRounds(st, pm)) continue;
    const plan = dueRounds(pm, st.pmLeadDays);
    if (plan.rounds.length === 0) continue;
    // รอบที่ครบก่อนวันเริ่มใช้ (ค้างจากแบบเดิม): ไม่เปิดย้อนทุกรอบ แต่ถ้าแผนนี้ไม่มีใบเปิดค้างเลย และรอบนี้ไม่มีรอบปัจจุบัน
    // ให้เปิด "รอบล่าสุดที่ค้าง" 1 ใบ (ผู้ใช้ 3/11/2569 "ออโต้ pm ทำไมไม่เปิดเอง") — งานไม่หายตอนเปิดใช้ · ไม่หักคะแนน (roundBeforeStart)
    const from = st.pmRoundsFrom;
    const hasCurrentRound = !from || plan.rounds.some((r) => r.getTime() >= from.getTime());
    const lastPast = from ? plan.rounds.filter((r) => r.getTime() < from.getTime()).at(-1) : undefined;

    for (const round of plan.rounds) {
      const made = await prisma.$transaction(async (tx) => {
        // ล็อกเดียวกับตัวเปิดใบแบบเดิม — cron ทับกันต้องไม่เปิดรอบเดียวกันสองใบ
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-auto-wo:${pm.id}`}))`;
        const linked = { OR: [{ pmScheduleId: pm.id }, { pmScheduleIds: { has: pm.id } }] };
        // รอบนี้มีใบแล้ว (ทุกสถานะ — ยกเลิก/รวบไปแล้วก็ไม่เปิดใหม่)
        const has = await tx.workOrder.findFirst({ where: { orgId: pm.orgId, pmRoundDate: round, ...linked }, select: { id: true } });
        if (has) return null;
        const loose = await tx.workOrder.findFirst({
          where: { orgId: pm.orgId, status: { in: OPEN }, pmRoundDate: null, ...linked },
          orderBy: { createdAt: "asc" },
          select: { id: true, dueDate: true },
        });
        if (loose) {
          await tx.workOrder.update({
            where: { id: loose.id },
            data: { pmRoundDate: round, dueDate: loose.dueDate ?? roundDueAt(round, st.pmLeadDays) },
          });
          return null;
        }
        if (from && round.getTime() < from.getTime()) {
          if (hasCurrentRound || round.getTime() !== lastPast?.getTime()) return null;
          const anyOpen = await tx.workOrder.findFirst({ where: { orgId: pm.orgId, status: { in: OPEN }, ...linked }, select: { id: true } });
          if (anyOpen) return null;
        }
        const code = await nextWorkOrderCode(tx, pm.orgId);
        return tx.workOrder.create({
          data: {
            orgId: pm.orgId,
            code,
            propertyId: pm.propertyId,
            assetId: pm.assetId,
            // เหมือนตัวเปิดใบแบบเดิม (data/cron.ts generateWorkOrdersForDuePms)
            assignedTo: pm.assignedTo ?? pm.createdBy ?? pm.property?.caretakerId ?? null,
            // แผนแบบกลุ่ม: ใบรอบได้ทีม วิธีปิดงาน และเช็กลิสต์จากแผน · แผนเดี่ยวได้ใบเดี่ยวเหมือนเดิม
            ...roundOrderTeam(pm, pm.assignedTo ?? pm.createdBy ?? pm.property?.caretakerId ?? null),
            title: pm.title,
            description: `PM: ${pm.title}\n${roundDescLine(fmtThaiDate(round), fmtThaiDate(roundDueAt(round, st.pmLeadDays)))}`,
            status: "open",
            priority: "medium",
            pmScheduleId: pm.id,
            pmRoundDate: round,
            dueDate: roundDueAt(round, st.pmLeadDays),
            ccUserIds: pm.ccUserIds,
            requiresExpense: pm.requiresExpense,
            autoCreated: true,
          },
        });
      });
      if (made) {
        created++;
        await logActivity(pm.orgId, {
          userId: null,
          actorLabel: "ระบบ (PM ตามรอบ)",
          entity: "work_order",
          entityId: made.id,
          entityCode: made.code,
          action: "create",
          summary: `เปิดใบงานอัตโนมัติจาก PM รอบ ${fmtThaiDate(round)} ${made.code} "${made.title}"`,
          detail: { pmScheduleId: pm.id, round: round.toISOString().slice(0, 10) },
        });
        await announceRound(pm, made, round);
      }
    }

    await prisma.pmSchedule.update({
      where: { id: pm.id },
      data: { nextDueDate: plan.nextDueDate, anchorDate: plan.anchorDate },
    });
  }
  return { created };
}

/** ใบรอบที่ยังไม่ปิดของแผนนี้ เรียงตามรอบ — ใบที่รวมหลายแผนไม่นับ เพราะเลื่อนตามแผนเดียวไม่ได้ */
export function openRoundsOfPm(orgId: string, pmId: string) {
  return prisma.workOrder.findMany({
    where: { orgId, pmScheduleId: pmId, status: { in: OPEN }, pmRoundDate: { not: null } },
    orderBy: { pmRoundDate: "asc" },
    select: { id: true, description: true },
  });
}

/**
 * วันรอบใหม่ของใบที่เปิดอยู่เมื่อแก้วันที่ในแผน: ใบแรก = วันที่เลือก ใบถัดไปไล่ตามความถี่
 * คืนรอบถัดไปให้แผนด้วย ใบที่เปิดแล้วจึงไม่ถูกเปิดซ้ำอีกรอบ
 */
export function roundsFromDate(
  pm: { frequency: string; roundsPerYear: number | null },
  start: Date,
  count: number,
): { rounds: Date[]; nextDueDate: Date; anchorDate: Date } {
  const rounds: Date[] = [];
  let cur = { nextDueDate: start, anchorDate: start as Date | null, frequency: pm.frequency, roundsPerYear: pm.roundsPerYear };
  for (let i = 0; i < count; i++) {
    rounds.push(cur.nextDueDate);
    const n = nextRound(cur);
    cur = { ...cur, nextDueDate: n.nextDue, anchorDate: n.anchor };
  }
  return { rounds, nextDueDate: cur.nextDueDate, anchorDate: cur.anchorDate ?? start };
}

/**
 * เปิดใบรอบทันทีตอนสร้าง/แก้แผน หรือตอนเปิดใช้โหมด ไม่รอ cron 08:00 (ผู้ใช้ 4/11/2569 "แจ้งมาตอนสร้างเลย")
 * ไม่ส่ง pmIds = ทุกแผนของบริษัท · เปิดไม่สำเร็จไม่ทำให้การบันทึกแผนล้ม cron เก็บให้รอบถัดไป
 */
export async function openRoundsNow(orgId: string, pmIds?: string[]): Promise<number> {
  try {
    const st = await loadRoundOrg(orgId);
    if (!st) return 0;
    return (await generateRoundWorkOrders(new Map([[orgId, st]]), pmIds)).created;
  } catch (error) {
    console.error("[pm-rounds] open now", error);
    return 0;
  }
}

/**
 * ใบรอบใหม่เปิดแล้ว — บอกผู้รับให้กด "รับงาน" (ผู้ใช้ 2/11/2569 "แจ้งเตือนให้ผู้รับ pm รู้และรับเรื่อง")
 * แจ้งเตือน (ในระบบ + LINE) ใช้หัวข้อ "ได้รับมอบหมายงานใหม่" แบบใบที่คนสร้าง ⇒ ค้างจนกดรับงาน/ปิด/ยกเลิก
 * การ์ดในแชทส่วนตัว: คนสร้างแผน PM ↔ ผู้รับ (แบบเดียวกับใบที่คนมอบหมาย) · ไม่มีคนสร้าง/คนเดียวกัน = แจ้งเตือนอย่างเดียว
 * CC ไม่ได้แจ้ง — แจ้งเฉพาะคนที่จะโดนหักคะแนน
 */
async function announceRound(
  pm: { orgId: string; title: string; createdBy: string | null; ccUserIds: string[] },
  wo: { id: string; code: string; title: string; assignedTo: string | null; groupMemberIds?: string[]; dueDate: Date | null },
  round: Date,
): Promise<void> {
  // แผนแบบกลุ่ม: ทุกคนในทีมได้แจ้ง + การ์ดในแชท
  for (const member of workOrderMemberIds(wo)) await announceTo(pm, { ...wo, assignedTo: member }, round);
}

async function announceTo(
  pm: { orgId: string; title: string; createdBy: string | null; ccUserIds: string[] },
  wo: { id: string; code: string; title: string; assignedTo: string | null; dueDate: Date | null },
  round: Date,
): Promise<void> {
  const roundLabel = fmtThaiDate(round);
  const due = wo.dueDate ? fmtThaiDate(wo.dueDate) : roundLabel;
  const how = `กด "รับงาน" ในใบงานเพื่อรับเรื่อง · ทำไม่ทันกด "ขอเลื่อนกำหนดส่ง" พร้อมเหตุผลก่อนถึงกำหนด (เลยกำหนดหักคะแนนทันที)`;
  if (wo.assignedTo) {
    await notifyUser(pm.orgId, wo.assignedTo, {
      title: `📋 ได้รับมอบหมายงานใหม่: PM ${wo.title} · รอบ ${roundLabel}`,
      body: `${wo.code} · ทำให้เสร็จภายใน ${due}
${how}`,
      type: "work_order",
      referenceId: wo.id,
      line: `📢 PM รอบใหม่: ${wo.title}
📅 รอบ ${roundLabel} · ทำให้เสร็จภายใน ${due}
✅ กด "รับงาน" ในใบงาน ${wo.code}
⏰ ทำไม่ทันให้ขอเลื่อนพร้อมเหตุผลก่อนถึงกำหนด`,
    });
    const assigner = pm.createdBy && pm.createdBy !== wo.assignedTo
      ? await prisma.user.findFirst({ where: { orgId: pm.orgId, id: pm.createdBy, isActive: true }, select: { id: true } })
      : null;
    if (assigner) {
      await postWorkOrderCard(pm.orgId, { assignerId: assigner.id, assigneeId: wo.assignedTo, workOrderId: wo.id, title: wo.title, dueDate: wo.dueDate });
    }
  }
  // CC ของแผนไม่ได้แจ้ง — แจ้งเฉพาะคนที่จะโดนหักคะแนน (ผู้ใช้ 2/11/2569) · CC ยังเปิดดูใบได้ตามสิทธิ์เดิม
}

/**
 * เปลี่ยนกติกา 10/11/2569 "เปิดในวันของรอบ แล้วให้เวลา 14 วัน" — ใบรอบอัตโนมัติที่ค้างจากกติกาเดิม:
 *   ยังไม่ถึงวันของรอบ + ยังไม่มีคนรับ → ปิดไปก่อน (ล้างแจ้งเตือน) แล้วถอยรอบถัดไปของแผนกลับมาที่วันนั้น ถึงวันระบบเปิดใหม่
 *   ถึงวันแล้ว/รับงานแล้ว → ขยายกำหนดส่งเป็น วันของรอบ + เวลาทำ และคืนคะแนน "ไม่ทำตามรอบ" ที่ระบบหักไปก่อนครบเวลาใหม่
 * ทำซ้ำได้ไม่เปลี่ยนอะไร (windowTransition คืน null เมื่อใบตรงกติกาใหม่แล้ว)
 */
export async function applyWindowTransition(orgs: Map<string, RoundOrg>, pmIds?: string[]): Promise<{ closed: number; extended: number }> {
  const wos = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.workOrder.findMany({
      where: {
        orgId: { in: [...orgs.keys()] },
        autoCreated: true,
        pmRoundDate: { not: null },
        pmScheduleId: pmIds ? { in: pmIds } : { not: null },
        status: { in: OPEN },
      },
      select: {
        id: true, orgId: true, code: true, title: true, status: true, pmRoundDate: true, pmScheduleId: true, dueDate: true, autoCreated: true, memberDueDates: true,
        checklist: true, photoUrls: true, afterPhotoUrls: true,
        _count: { select: { comments: true, externalPhotos: true } },
      },
    }),
  );
  const today = todayBkkDate();
  let closed = 0;
  let extended = 0;
  const rewind = new Map<string, { orgId: string; round: Date }>(); // แผน → รอบแรกที่ถูกปิด (ให้ระบบเปิดใหม่เมื่อถึงวัน)
  for (const wo of wos) {
    const st = orgs.get(wo.orgId);
    if (!st) continue;
    let act = windowTransition(wo, st.pmLeadDays, today);
    if (!act) continue;
    // มีร่องรอยว่าเริ่มทำแล้ว (คอมเมนต์ / รูป / ติ๊กเช็กลิสต์) — ไม่ปิดทิ้ง ขยายเวลาแทน งานที่ทำไว้ไม่หาย
    if (act === "close" && hasWorkStarted(wo)) act = "extend";
    const round = wo.pmRoundDate!;
    if (act === "close") {
      const done = await prisma.workOrder.updateMany({
        where: { id: wo.id, orgId: wo.orgId, status: "open" },
        data: {
          status: "cancelled",
          pmRoundDate: null, // ปล่อยรอบนี้ว่าง ถึงวันระบบเปิดใบใหม่ได้
          completionNotes: `ปิดไปก่อน — ยังไม่ถึงวันของรอบ (${fmtThaiDate(round)}) ตามกติกาใหม่ใบรอบเปิดในวันนั้นและมีเวลาทำ ${st.pmLeadDays} วัน`,
        },
      });
      if (done.count === 0) continue;
      closed++;
      await deleteNotificationsByReference(wo.id).catch(() => {});
      // การ์ดมอบหมายในแชทส่วนตัว — ใบปิดแล้ว ซ่อนการ์ดด้วย ไม่ให้กดไปเจอใบที่ยกเลิก
      await prisma.chatMessage.updateMany({ where: { orgId: wo.orgId, clientId: `wo-${wo.id}`, deletedAt: null }, data: { deletedAt: new Date() } });
      const prev = rewind.get(wo.pmScheduleId!);
      if (!prev || round.getTime() < prev.round.getTime()) rewind.set(wo.pmScheduleId!, { orgId: wo.orgId, round });
      await logActivity(wo.orgId, {
        userId: null,
        actorLabel: "ระบบ (PM ตามรอบ)",
        entity: "work_order",
        entityId: wo.id,
        entityCode: wo.code,
        action: "update",
        summary: `ปิด ${wo.code} ไปก่อน — รอบ ${fmtThaiDate(round)} ยังไม่ถึงวัน จะเปิดใหม่เมื่อถึงวัน`,
        detail: { pmScheduleId: wo.pmScheduleId, round: ymd(round), rule: "open-on-round-date" },
      });
      continue;
    }
    const due = roundDueAt(round, st.pmLeadDays);
    const dueDay = ymd(new Date(due.getTime() + 7 * 3600e3));
    // ใบกลุ่ม: วันรายคนที่เร็วกว่ากติกาใหม่ ขยายตามด้วย
    const members = wo.memberDueDates as Record<string, string> | null;
    const nextMembers = members
      ? Object.fromEntries(Object.entries(members).map(([u, d]) => [u, d < dueDay ? dueDay : d]))
      : undefined;
    await prisma.workOrder.update({
      where: { id: wo.id, orgId: wo.orgId },
      data: { dueDate: due, ...(nextMembers ? { memberDueDates: nextMembers } : {}) },
    });
    extended++;
    // การ์ดในแชทเก็บกำหนดส่งไว้ในตัวการ์ด — แก้ให้ตรงกับกำหนดส่งใหม่
    const cards = await prisma.chatMessage.findMany({ where: { orgId: wo.orgId, clientId: `wo-${wo.id}`, deletedAt: null }, select: { id: true, meta: true } });
    for (const c of cards) {
      const meta = (c.meta ?? {}) as Record<string, unknown>;
      await prisma.chatMessage.update({ where: { id: c.id, orgId: wo.orgId }, data: { meta: { ...meta, dueDate: due.toISOString() } } });
    }
    // คะแนน "ไม่ทำตามรอบ" ที่ระบบหักไปแล้ว ทั้งที่ตามกติกาใหม่ยังไม่ครบเวลา — คืน (ผู้ใช้ "ให้เวลาทำไปเลย ไม่ต้องไปหักคะแนน")
    if (due.getTime() > Date.now()) {
      const ref = roundDockRefId(wo.pmScheduleId!, round, wo.id);
      await prisma.performanceEvent.deleteMany({
        where: { orgId: wo.orgId, source: "maintenance", category: "pm_missed", refId: { startsWith: ref } },
      });
    }
    await logActivity(wo.orgId, {
      userId: null,
      actorLabel: "ระบบ (PM ตามรอบ)",
      entity: "work_order",
      entityId: wo.id,
      entityCode: wo.code,
      action: "update",
      summary: `ขยายกำหนดส่ง ${wo.code} เป็น ${fmtThaiDate(due)} — กติกาใหม่ให้เวลาทำ ${st.pmLeadDays} วันนับจากวันของรอบ (ไม่หักคะแนน)`,
      detail: { pmScheduleId: wo.pmScheduleId, round: ymd(round), rule: "open-on-round-date" },
    });
  }
  for (const [pmId, { orgId, round }] of rewind) {
    await prisma.pmSchedule.updateMany({
      where: { id: pmId, orgId, nextDueDate: { gt: round } },
      // anchor ไม่แตะ — แผนตั้งวันที่ 31 ต้องไม่หดเป็น 30 ถาวรเพราะรอบที่ถอยกลับเป็นเดือน 30 วัน
      data: { nextDueDate: round },
    });
  }
  return { closed, extended };
}

/** ใบนี้มีคนเริ่มทำแล้วไหม — คอมเมนต์ รูป หรือติ๊กเช็กลิสต์ไปบ้าง */
function hasWorkStarted(wo: {
  checklist: unknown;
  photoUrls: string[] | null;
  afterPhotoUrls: string[] | null;
  _count: { comments: number; externalPhotos: number };
}): boolean {
  const items = Array.isArray(wo.checklist) ? (wo.checklist as { done?: boolean }[]) : [];
  // บนเซิร์ฟเวอร์จริงช่องรูปของใบอัตโนมัติเป็น NULL (ไม่ใช่ []) — เจอจากผลเช็คก่อนดีพอย 10/11/2569
  return (
    wo._count.comments > 0 ||
    wo._count.externalPhotos > 0 ||
    (wo.photoUrls?.length ?? 0) > 0 ||
    (wo.afterPhotoUrls?.length ?? 0) > 0 ||
    items.some((i) => i?.done)
  );
}

/** รอบถัดไปของแผนที่คนตั้ง PM เลือกทำก่อนได้ — ไม่รวมรอบที่มีใบแล้ว (ทุกสถานะ) */
export async function earlyRoundOptions(
  orgId: string,
  pm: { id: string; nextDueDate: Date; anchorDate: Date | null; frequency: string; roundsPerYear: number | null },
  count = 6,
): Promise<Date[]> {
  const taken = await prisma.workOrder.findMany({
    where: { orgId, pmRoundDate: { gte: pm.nextDueDate }, OR: [{ pmScheduleId: pm.id }, { pmScheduleIds: { has: pm.id } }] },
    select: { pmRoundDate: true },
  });
  return upcomingRounds(pm, count, new Set(taken.map((t) => ymd(t.pmRoundDate!))));
}

/**
 * ทำรอบล่วงหน้า (ผู้ใช้ 10/11/2569 "แพลนออโต้ถ้าจะขอทำก่อนทำได้ เลือกรอบวันเองได้") — คนตั้ง PM เท่านั้น
 * เปิดใบของรอบที่เลือกตอนนี้เลย กำหนดส่ง = วันของรอบ + เวลาทำ (เหมือนรอบปกติ) · ทำเสร็จ = รอบนั้นจบ
 * ถึงวันของรอบแล้วระบบเห็นว่ามีใบแล้ว จึงไม่เปิดซ้ำ
 */
export async function openEarlyRound(
  orgId: string,
  pmId: string,
  roundDay: string,
  userId: string,
): Promise<{ id: string } | { error: string }> {
  const st = await loadRoundOrg(orgId);
  const pm = await prisma.pmSchedule.findFirst({
    where: { id: pmId, orgId, isActive: true },
    include: { property: { select: { caretakerId: true } } },
  });
  if (!pm || !st || !pmUsesRounds(st, pm)) return { error: "แผนนี้ไม่ได้เดินแบบนับรอบ" };
  if (pm.createdBy !== userId) return { error: "ทำรอบล่วงหน้าได้เฉพาะคนตั้ง PM" };
  const options = await earlyRoundOptions(orgId, pm);
  const round = options.find((d) => ymd(d) === roundDay);
  if (!round) return { error: "รอบนี้มีใบงานแล้ว หรือไม่ใช่รอบของแผนนี้" };

  const made = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-auto-wo:${pm.id}`}))`;
    const has = await tx.workOrder.findFirst({
      where: { orgId, pmRoundDate: round, OR: [{ pmScheduleId: pm.id }, { pmScheduleIds: { has: pm.id } }] },
      select: { id: true },
    });
    if (has) return null;
    const code = await nextWorkOrderCode(tx, orgId);
    const assignee = pm.assignedTo ?? pm.createdBy ?? pm.property?.caretakerId ?? null;
    const due = roundDueAt(round, st.pmLeadDays);
    return tx.workOrder.create({
      data: {
        orgId,
        code,
        propertyId: pm.propertyId,
        assetId: pm.assetId,
        assignedTo: assignee,
        ...roundOrderTeam(pm, assignee),
        title: pm.title,
        description: `PM: ${pm.title}\n${roundDescLine(fmtThaiDate(round), fmtThaiDate(due))}\nทำล่วงหน้า (เปิดก่อนถึงวันของรอบ)`,
        status: "open",
        priority: "medium",
        pmScheduleId: pm.id,
        pmRoundDate: round,
        dueDate: due,
        ccUserIds: pm.ccUserIds,
        requiresExpense: pm.requiresExpense,
        // คนตั้ง PM เปิดเอง — ไม่ใช่ใบอัตโนมัติ (ตัวปรับกติกาเดิมจะไม่ไปปิดใบนี้)
        autoCreated: false,
        createdBy: userId,
      },
    });
  });
  if (!made) return { error: "รอบนี้มีใบงานแล้ว" };
  await logActivity(orgId, {
    userId,
    entity: "work_order",
    entityId: made.id,
    entityCode: made.code,
    action: "create",
    summary: `เปิดใบ PM รอบ ${fmtThaiDate(round)} ล่วงหน้า ${made.code} "${made.title}"`,
    detail: { pmScheduleId: pm.id, round: ymd(round), early: true },
  });
  await announceRound(pm, made, round);
  return { id: made.id };
}

export interface PileupRound {
  id: string;
  code: string;
  round: Date;
  dueDate: Date | null;
  assignedTo: string | null;
  status: string;
  overdueScore: string | null;
  /** คะแนนที่ระบบหักไปแล้วของใบนี้ (ติดลบ) — 0 = ยังไม่หัก */
  docked: number;
}

export interface Pileup {
  pmId: string;
  title: string;
  frequency: string;
  propertyName: string;
  rounds: PileupRound[];
}

/** แผนที่มีใบรอบเลยกำหนดค้างพร้อมกันตั้งแต่ PILEUP_MIN_ROUNDS ใบ — ให้ CEO ตัดสิน */
export async function listPileups(orgId: string): Promise<Pileup[]> {
  const late = await prisma.workOrder.findMany({
    where: { orgId, status: { in: OPEN }, pmRoundDate: { not: null }, pmScheduleId: { not: null }, dueDate: { lt: new Date() } },
    select: { id: true, code: true, pmScheduleId: true, pmRoundDate: true, dueDate: true, assignedTo: true, status: true, overdueScore: true },
    orderBy: { pmRoundDate: "asc" },
  });
  const byPm = new Map<string, typeof late>();
  for (const w of late) byPm.set(w.pmScheduleId!, [...(byPm.get(w.pmScheduleId!) ?? []), w]);
  const pmIds = [...byPm].filter(([, ws]) => ws.length >= PILEUP_MIN_ROUNDS).map(([id]) => id);
  if (pmIds.length === 0) return [];

  const [pms, docks] = await Promise.all([
    prisma.pmSchedule.findMany({
      where: { orgId, id: { in: pmIds } },
      select: { id: true, title: true, frequency: true, property: { select: { name: true } } },
    }),
    prisma.performanceEvent.findMany({
      where: {
        orgId,
        category: "pm_missed",
        refType: "pm_schedule",
        // ใบรอบแบบกลุ่มหักแยกคน (…:คน) — นับรวมทั้งใบ
        OR: pmIds.flatMap((id) => byPm.get(id)!.map((w) => ({ refId: { startsWith: roundDockRefId(id, w.pmRoundDate!, w.id) } }))),
      },
      select: { refId: true, points: true },
    }),
  ]);
  const dockBy = new Map<string, number>();
  // คะแนนที่หักไปแล้ว (รวมที่คืนด้วยคำขอแก้คะแนน — refType _undo ไม่อยู่ในชุดนี้ จึงนับเฉพาะที่หัก)
  for (const d of docks) {
    const woId = roundDockWorkOrderId(d.refId);
    if (woId) dockBy.set(woId, (dockBy.get(woId) ?? 0) + Number(d.points));
  }

  return pms
    .map((pm) => ({
      pmId: pm.id,
      title: pm.title,
      frequency: pm.frequency,
      propertyName: pm.property?.name ?? "-",
      rounds: byPm.get(pm.id)!.map((w) => ({
        id: w.id,
        code: w.code,
        round: w.pmRoundDate!,
        dueDate: w.dueDate,
        assignedTo: w.assignedTo,
        status: w.status,
        overdueScore: w.overdueScore,
        docked: dockBy.get(w.id) ?? 0,
      })),
    }))
    .sort((a, b) => b.rounds.length - a.rounds.length || a.title.localeCompare(b.title, "th"));
}

/** จำนวนแผนที่ค้างหลายรอบ — กล่องแจ้งบนแดชบอร์ด */
export async function countPileups(orgId: string): Promise<number> {
  const rows = await prisma.workOrder.groupBy({
    by: ["pmScheduleId"],
    where: { orgId, status: { in: OPEN }, pmRoundDate: { not: null }, pmScheduleId: { not: null }, dueDate: { lt: new Date() } },
    _count: { _all: true },
  });
  return rows.filter((r) => r._count._all >= PILEUP_MIN_ROUNDS).length;
}
