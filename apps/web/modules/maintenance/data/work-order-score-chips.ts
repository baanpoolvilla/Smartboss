import "server-only";
import { prisma } from "@smartboss/database";
import { roundDockRefId, roundDockWorkOrderId } from "@/modules/maintenance/lib/pm-rounds";
import { workOrderIdOfDockRef } from "@/modules/maintenance/lib/work-order-members";

/**
 * ป้ายคะแนนบนการ์ดใบงาน แบบเดียวกับการ์ดงาน (ผู้ใช้ 6/11/2569 "เอาแบบของ task เลย")
 *  - docked: โดนหักแล้ว ป้ายแดง −N (ใบกลุ่มรวมทุกคน)
 *  - refunded: หักแล้วแต่คืนด้วยคำขอแก้คะแนน ป้ายเขียว คืน +N
 *  - waived: CEO ยกเว้นคะแนนใบนี้ก่อนโดนหัก ป้ายเขียว ไม่หักคะแนน
 */
export type WorkOrderScoreChip = { kind: "docked" | "refunded"; points: number } | { kind: "waived" };

type Row = { id: string; pmScheduleId: string | null; pmRoundDate: Date | null; overdueScore: string | null };

export async function workOrderScoreChips(orgId: string, rows: Row[]): Promise<Map<string, WorkOrderScoreChip>> {
  const out = new Map<string, WorkOrderScoreChip>();
  if (rows.length === 0) return out;
  const events = await prisma.performanceEvent.findMany({
    where: {
      orgId,
      source: "maintenance",
      category: { in: ["workorder_overdue", "pm_missed"] },
      OR: rows.flatMap((r) => [
        { refId: r.id },
        { refId: { startsWith: `${r.id}:` } },
        ...(r.pmRoundDate && r.pmScheduleId ? [{ refId: { startsWith: roundDockRefId(r.pmScheduleId, r.pmRoundDate, r.id) } }] : []),
      ]),
    },
    select: { category: true, refId: true, refType: true, points: true },
  });
  const docked = new Map<string, number>();
  const undone = new Map<string, number>();
  for (const e of events) {
    const woId = e.category === "pm_missed" ? roundDockWorkOrderId(e.refId) : e.refId ? workOrderIdOfDockRef(e.refId) : null;
    if (!woId) continue;
    const bucket = e.refType?.endsWith("_undo") ? undone : docked;
    bucket.set(woId, (bucket.get(woId) ?? 0) + Math.abs(Number(e.points)));
  }
  for (const r of rows) {
    const d = docked.get(r.id) ?? 0;
    const u = undone.get(r.id) ?? 0;
    if (d > u) out.set(r.id, { kind: "docked", points: d - u });
    else if (d > 0) out.set(r.id, { kind: "refunded", points: d });
    else if (r.overdueScore === "waived") out.set(r.id, { kind: "waived" });
  }
  return out;
}
