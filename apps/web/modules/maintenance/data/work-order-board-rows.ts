import { workOrderScoreChips } from "@/modules/maintenance/data/work-order-score-chips";
import { earliestPendingDue } from "@/modules/maintenance/lib/work-order-members";
import "server-only";
import { prisma } from "@smartboss/database";
import type { BoardOrder } from "@/modules/maintenance/components/work-order-board";
import { loadExpenseTracking, pendingExpenseWorkOrders } from "@/modules/maintenance/data/expense-tracking";
import type { listWorkOrders } from "@/modules/maintenance/data/work-orders";
import { realExpenseTotal } from "@/modules/maintenance/lib/expense-batches";
import { expenseDueAt, trackingActive } from "@/modules/maintenance/lib/expense-deadline";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";

/** ข้อมูลการ์ดบนบอร์ดใบงาน — ใช้ทั้งตอนเปิดหน้าและตอนกดแสดงเพิ่มเติมในคอลัมน์เสร็จแล้ว */
export async function buildBoardRows(
  orgId: string,
  orders: Awaited<ReturnType<typeof listWorkOrders>>,
  expenseSet: Set<string>,
  tracking: Awaited<ReturnType<typeof loadExpenseTracking>>,
): Promise<BoardOrder[]> {
  const trackingOn = trackingActive(tracking);
  // การ์ดแบบการ์ดงาน: จำนวนความคิดเห็น (ไม่นับบันทึกระบบ) + คำขอเลื่อนที่รออนุมัติ ต่อใบ
  const orderIds = orders.map((o) => o.id);
  const [commentCounts, dueReqCounts] = orderIds.length
    ? await Promise.all([
        prisma.workOrderComment.groupBy({
          by: ["workOrderId"],
          where: { orgId, workOrderId: { in: orderIds }, OR: [{ kind: null }, { kind: { not: "log" } }] },
          _count: { _all: true },
        }),
        prisma.workOrderDueRequest.groupBy({
          by: ["workOrderId"],
          where: { orgId, workOrderId: { in: orderIds }, status: "pending" },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const commentsBy = new Map(commentCounts.map((c) => [c.workOrderId, c._count._all]));
  const dueReqBy = new Map(dueReqCounts.map((c) => [c.workOrderId, c._count._all]));
  // ชื่อทั้งผู้เปิดและผู้ได้รับมอบหมาย — ใช้ตารางเดียวกัน (การ์ด + ตัวกรองผู้รับผิดชอบ)
  // ยอดจ่ายจริง (ใบหลายบ้านนับครั้งเดียว) · ใบรอต้นทาง (PR/PO/ใบเบิก) = ไม่อยู่ในรายการรอบันทึก
  const expenseRows = trackingOn && orderIds.length
    ? await prisma.expense.findMany({
        where: { orgId, workOrderId: { in: orderIds } },
        select: { workOrderId: true, createdBy: true, amount: true, description: true, createdAt: true },
      })
    : [];
  const expenseTotals = new Map(
    [...new Set(expenseRows.map((r) => r.workOrderId))].map((id) => [id, realExpenseTotal(expenseRows.filter((r) => r.workOrderId === id))] as const),
  );
  const scoreChips = await workOrderScoreChips(orgId, orders);
  const pendingClock = new Map(trackingOn ? (await pendingExpenseWorkOrders(orgId)).map((o) => [o.id, o.clockFrom] as const) : []);
  return orders
    .map((o) => ({
      id: o.id,
      code: o.code,
      title: o.title,
      description: o.description,
      status: o.status,
      priority: o.priority,
      propertyId: o.propertyId,
      additionalPropertyIds: o.additionalPropertyIds,
      createdBy: o.createdBy,
      assignedTo: o.assignedTo,
      groupMemberIds: o.groupMemberIds,
      autoCreated: o.autoCreated,
      createdAtLabel: fmtThaiDate(o.createdAt),
      hasExpense: expenseSet.has(o.id),
      requiresExpense: o.requiresExpense,
      pmRound: o.pmRoundDate ? pmRoundTag(o.pmRoundDate, o.dueDate, o.status) : null,
      isPrivate: o.isPrivate,
      isPm: !!o.pmScheduleId || o.pmScheduleIds.length > 0,
      dueDateIso: earliestPendingDue(o)?.toISOString() ?? null,
      expenseRecordedTotal: o.status === "completed" ? (expenseTotals.get(o.id) ?? null) : null,
      expenseDeadlineIso: pendingClock.has(o.id) ? expenseDueAt({ ...o, clockFrom: pendingClock.get(o.id) }, tracking).toISOString() : null,
      expenseHeld: trackingOn && o.status === "completed" && o.requiresExpense && !o.isPrivate && !expenseSet.has(o.id) && !pendingClock.has(o.id),
      commentCount: commentsBy.get(o.id) ?? 0,
      photoCount: o.photoUrls.length + o.afterPhotoUrls.length,
      pendingDue: dueReqBy.get(o.id) ?? 0,
      score: scoreChips.get(o.id),
      due: dueTag(earliestPendingDue(o), o.status),
    }));
}

/** ป้ายใบรอบ PM บนการ์ด — "รอบ 1 ธ.ค. 2569" + เหลือ/เลยกี่วัน (นับตามวันไทยของกำหนดส่ง) */
function pmRoundTag(round: Date, due: Date | null, status: string): BoardOrder["pmRound"] {
  const open = status === "open" || status === "in_progress";
  if (!open || !due) return { label: fmtThaiDate(round), due: null, late: false };
  const day = (d: Date) => Date.parse(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10));
  const days = Math.round((day(due) - day(new Date())) / 86_400_000);
  return {
    label: fmtThaiDate(round),
    due: days < 0 ? `เลยกำหนด ${-days} วัน` : days === 0 ? "ครบกำหนดวันนี้" : `เหลือ ${days} วัน`,
    late: days < 0,
  };
}

/** วันครบกำหนดบนการ์ด (แบบการ์ดงาน) — ใบที่ยังเปิดและเลยแล้วขึ้นแดง "เลยกำหนด N วัน" */
function dueTag(due: Date | null, status: string): BoardOrder["due"] {
  if (!due) return null;
  const day = (d: Date) => Date.parse(new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10));
  const open = status === "open" || status === "in_progress";
  const days = Math.round((day(due) - day(new Date())) / 86_400_000);
  if (open && days < 0) return { text: `เลยกำหนด ${-days} วัน`, late: true };
  return { text: `ครบ ${fmtThaiDate(due)}`, late: false };
}
