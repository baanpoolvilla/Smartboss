import { requireOrg, hasPermission } from "@smartboss/auth";
import { prisma } from "@smartboss/database";

import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { readStore } from "@/modules/report_task/lib/db/org-store";
import { listPenaltyRequests } from "@/modules/report_task/lib/db/report-penalty-requests";
import { PERFORMANCE_CATEGORIES, type PerformanceCategory } from "@/lib/performance";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { effectiveRoundsOf } from "@/modules/report_task/lib/submission-rounds";

/**
 * รายการ event หักคะแนนรายงาน (report_missed/report_late) ที่ยัง active อยู่
 * (ยังไม่เคยถูกคืนคะแนน) ของคน+หมวดหนึ่ง — ใช้เติมตัวเลือก "รอบไหน" ในไดอะล็อก
 * ขอแก้ไข เพราะหน้าคะแนน & เกรด โชว์แค่ยอดรวมต่อหมวด (เช่น "-2 ×14") ไม่ได้
 * แยกเป็นรายครั้งให้เลือก
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOrg();

  const params = new URL(request.url).searchParams;
  const userId = params.get("userId");
  const category = params.get("category");
  if (!userId || (category !== "report_missed" && category !== "report_late")) {
    return Response.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }
  // ดูของตัวเองได้เสมอ — ดูของคนอื่นต้องเห็นหน้าคะแนนรวมได้ (หัวหน้า/HR/CEO)
  if (userId !== session.userId && !hasPermission(session, ADMIN_PERMS.performanceView)) {
    return Response.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const [events, undoRefIds, requests, { data: reportFeed }] = await Promise.all([
    prisma.performanceEvent.findMany({
      where: { orgId: session.orgId, userId, source: "report_task", refType: "report_round", category },
      select: { refId: true, points: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.performanceEvent
      .findMany({
        where: { orgId: session.orgId, userId, source: "report_task", refType: "report_round_undo", category },
        select: { refId: true },
      })
      .then((rows) => new Set(rows.map((r) => r.refId))),
    listPenaltyRequests(session.orgId),
    readStore<{ topics: ReportTopic[] }>(session.orgId, "report-feed"),
  ]);

  const topics = reportFeed?.topics ?? [];
  const topicById = new Map(topics.map((t) => [t.id, t] as const));
  const pendingRefIds = new Set(requests.filter((r) => r.status === "pending").map((r) => r.refId));

  const items = events
    .filter((e) => e.refId && !undoRefIds.has(e.refId))
    .map((e) => {
      const parts = e.refId!.split(":");
      const [day, topicId, roundId] = parts.length === 4 ? parts : [null, null, null];
      const topic = topicId ? topicById.get(topicId) : undefined;
      const round = topic ? effectiveRoundsOf(topic).find((r) => r.id === roundId) : undefined;
      return {
        refId: e.refId!,
        points: Number(e.points),
        day,
        topicName: topic?.name ?? topicId ?? "-",
        roundLabel: round?.label ?? roundId ?? "-",
        hasPendingRequest: pendingRefIds.has(e.refId!),
      };
    });

  return Response.json({ categoryLabel: PERFORMANCE_CATEGORIES[category as PerformanceCategory], items });
}
