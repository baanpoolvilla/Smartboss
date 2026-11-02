import "server-only";
import { prisma } from "@smartboss/database";
import { crossOrg } from "@smartboss/database/cross-org";

import { nextWorkOrderCode } from "@/lib/document-code";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { logActivity } from "@/modules/maintenance/data/activity";
import {
  dueRounds,
  PILEUP_MIN_ROUNDS,
  pmUsesRounds,
  roundDueAt,
  roundModeOn,
  todayBkkDate,
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
export async function generateRoundWorkOrders(orgs: Map<string, RoundOrg>): Promise<{ created: number }> {
  if (orgs.size === 0) return { created: 0 };
  const pms = await crossOrg("cron:platform-job-resolves-org-per-row", () =>
    prisma.pmSchedule.findMany({
      where: { orgId: { in: [...orgs.keys()] }, isActive: true, awaitingSchedule: false, totalRounds: null },
      include: { property: { select: { caretakerId: true } } },
    }),
  );

  let created = 0;
  for (const pm of pms) {
    const st = orgs.get(pm.orgId);
    if (!st || !pmUsesRounds(st, pm)) continue;
    const plan = dueRounds(pm, st.pmLeadDays);
    if (plan.rounds.length === 0) continue;

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
            data: { pmRoundDate: round, dueDate: loose.dueDate ?? roundDueAt(round) },
          });
          return null;
        }
        if (st.pmRoundsFrom && round.getTime() < st.pmRoundsFrom.getTime()) return null;
        const code = await nextWorkOrderCode(tx, pm.orgId);
        return tx.workOrder.create({
          data: {
            orgId: pm.orgId,
            code,
            propertyId: pm.propertyId,
            assetId: pm.assetId,
            // เหมือนตัวเปิดใบแบบเดิม (data/cron.ts generateWorkOrdersForDuePms)
            assignedTo: pm.assignedTo ?? pm.createdBy ?? pm.property?.caretakerId ?? null,
            title: pm.title,
            description: `PM: ${pm.title}\nรอบครบกำหนด ${fmtThaiDate(round)}`,
            status: "open",
            priority: "medium",
            pmScheduleId: pm.id,
            pmRoundDate: round,
            dueDate: roundDueAt(round),
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
      }
    }

    await prisma.pmSchedule.update({
      where: { id: pm.id },
      data: { nextDueDate: plan.nextDueDate, anchorDate: plan.anchorDate },
    });
  }
  return { created };
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
      where: { orgId, category: "workorder_overdue", refId: { in: pmIds.flatMap((id) => byPm.get(id)!.map((w) => w.id)) } },
      select: { refId: true, points: true },
    }),
  ]);
  const dockBy = new Map<string, number>();
  for (const d of docks) dockBy.set(d.refId!, (dockBy.get(d.refId!) ?? 0) + Number(d.points));

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
