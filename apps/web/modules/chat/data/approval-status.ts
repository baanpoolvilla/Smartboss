import "server-only";
import { prisma } from "@smartboss/database";

import type { ChatTaskCard } from "../types";
import { taskRequestStatus, type ApprovalStatusPart } from "../lib/approval";

/**
 * สถานะสดของการ์ดคำขอชุดนี้ — คีย์ = `${source}:${requestId}` · อ่านรวมครั้งเดียวต่อชุดข้อความ
 * ใบงาน: ตาราง work_order_due_requests · งาน: reportTask.data.dueDateRequests
 */
export async function liveApprovalStatuses(orgId: string, cards: ChatTaskCard[]): Promise<Map<string, ApprovalStatusPart>> {
  const out = new Map<string, ApprovalStatusPart>();
  const woIds = [...new Set(cards.filter((c) => c.approval && c.approval.source !== "task").map((c) => c.approval!.requestId))];
  const taskIds = [...new Set(cards.filter((c) => c.approval?.source === "task").map((c) => c.taskId))];
  const [woRows, taskRows] = await Promise.all([
    woIds.length
      ? prisma.workOrderDueRequest
          .findMany({ where: { orgId, id: { in: woIds } }, select: { id: true, kind: true, status: true, decidedBy: true, decidedAt: true, decisionNote: true } })
          .catch(() => [])
      : [],
    taskIds.length ? prisma.reportTask.findMany({ where: { orgId, id: { in: taskIds } }, select: { id: true, data: true } }).catch(() => []) : [],
  ]);
  for (const r of woRows) {
    const status = (["pending", "approved", "rejected", "cancelled"] as const).find((s) => s === r.status);
    if (!status) continue;
    out.set(`${r.kind === "expense" ? "expense" : "work_order"}:${r.id}`, {
      status,
      ...(r.decidedBy ? { decidedBy: r.decidedBy } : {}),
      ...(r.decidedAt ? { decidedAt: r.decidedAt.toISOString() } : {}),
      ...(r.decisionNote ? { decisionNote: r.decisionNote } : {}),
    });
  }
  const dataById = new Map(taskRows.map((t) => [t.id, t.data]));
  for (const c of cards) {
    if (c.approval?.source !== "task") continue;
    const s = taskRequestStatus(dataById.get(c.taskId), c.approval.requestId);
    // งานถูกลบ/คำขอหายไปแล้ว = ปิดการ์ด (กดไม่ได้)
    out.set(`task:${c.approval.requestId}`, s ?? { status: "cancelled" });
  }
  return out;
}
