import "server-only";
import { prisma } from "@smartboss/database";

import type { ChatReviewInfo, ChatTaskCard } from "../types";
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

export type ReviewStatusPart = Pick<ChatReviewInfo, "status" | "decidedBy" | "decidedAt" | "note">;

/**
 * สถานะสดของการ์ด "รอตรวจ" — คีย์ = `${source}:${taskId}:${submittedAt}` · อ่านรวมครั้งเดียวต่อชุดข้อความ
 * รอบที่การ์ดชี้ (submittedAt) ไม่ใช่รอบปัจจุบันแล้ว = จบไปแล้ว (ไม่ผ่านถ้ารู้ ไม่งั้น closed) — กดไม่ได้
 */
export async function liveReviewStatuses(orgId: string, cards: ChatTaskCard[]): Promise<Map<string, ReviewStatusPart>> {
  const out = new Map<string, ReviewStatusPart>();
  const taskIds = [...new Set(cards.filter((c) => c.review?.source === "task").map((c) => c.taskId))];
  const woIds = [...new Set(cards.filter((c) => c.review?.source === "work_order").map((c) => c.taskId))];
  const [taskRows, woRows] = await Promise.all([
    taskIds.length
      ? prisma.reportTask.findMany({ where: { orgId, id: { in: taskIds } }, select: { id: true, status: true, completedAt: true, data: true } }).catch(() => [])
      : [],
    woIds.length
      ? prisma.workOrder
          .findMany({
            where: { orgId, id: { in: woIds } },
            select: { id: true, status: true, reviewState: true, reviewSubmittedAt: true, reviewedBy: true, reviewedAt: true, reviewNote: true },
          })
          .catch(() => [])
      : [],
  ]);
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const woById = new Map(woRows.map((w) => [w.id, w]));
  for (const c of cards) {
    const r = c.review;
    if (!r) continue;
    const key = `${r.source}:${c.taskId}:${r.submittedAt}`;
    if (r.source === "task") {
      const t = taskById.get(c.taskId);
      out.set(key, t ? taskReviewStatus(t, r.submittedAt) : { status: "closed" });
    } else {
      const w = woById.get(c.taskId);
      out.set(key, w ? woReviewStatus(w, r.submittedAt) : { status: "closed" });
    }
  }
  return out;
}

function taskReviewStatus(t: { status: string; completedAt: string | null; data: unknown }, submittedAt: string): ReviewStatusPart {
  const d = t.data && typeof t.data === "object" ? (t.data as Record<string, unknown>) : {};
  if (t.status === "done" && t.completedAt === submittedAt) {
    if (typeof d.reviewedBy === "string" && d.reviewedBy) {
      return { status: "passed", decidedBy: d.reviewedBy, ...(typeof d.reviewedAt === "string" ? { decidedAt: d.reviewedAt } : {}) };
    }
    return { status: "pending" };
  }
  // ส่งกลับไปแก้ (rejectReview เพิ่ม revision ทุกครั้ง) หลังรอบนี้ส่ง = ไม่ผ่าน
  const revs = Array.isArray(d.revisions) ? (d.revisions as Record<string, unknown>[]) : [];
  const back = revs.find((v) => v && typeof v.revisedAt === "string" && v.revisedAt > submittedAt);
  if (back) {
    return {
      status: "failed",
      ...(typeof back.revisedBy === "string" ? { decidedBy: back.revisedBy } : {}),
      decidedAt: back.revisedAt as string,
      ...(typeof back.reason === "string" && back.reason ? { note: back.reason.slice(0, 500) } : {}),
    };
  }
  return { status: "closed" };
}

function woReviewStatus(
  w: { status: string; reviewState: string; reviewSubmittedAt: Date | null; reviewedBy: string | null; reviewedAt: Date | null; reviewNote: string | null },
  submittedAt: string
): ReviewStatusPart {
  const sameRound = w.reviewSubmittedAt?.toISOString() === submittedAt;
  const decided = {
    ...(w.reviewedBy ? { decidedBy: w.reviewedBy } : {}),
    ...(w.reviewedAt ? { decidedAt: w.reviewedAt.toISOString() } : {}),
  };
  if (sameRound && w.reviewState === "pending" && w.status === "completed") return { status: "pending" };
  if (sameRound && w.reviewState === "passed") return { status: "passed", ...decided };
  if (sameRound && w.reviewState === "failed") return { status: "failed", ...decided, ...(w.reviewNote ? { note: w.reviewNote } : {}) };
  return { status: "closed" };
}
