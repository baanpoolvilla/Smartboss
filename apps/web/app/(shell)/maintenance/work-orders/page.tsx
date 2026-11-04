import { redirect } from "next/navigation";
import { loadExpenseTracking, pendingExpenseWorkOrders } from "@/modules/maintenance/data/expense-tracking";
import { realExpenseTotal } from "@/modules/maintenance/lib/expense-batches";
import { expenseDueAt, isExpenseBacklog, trackingActive } from "@/modules/maintenance/lib/expense-deadline";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { prisma } from "@smartboss/database";
import { AppScaffold, Fab } from "@/modules/maintenance/components/app-scaffold";
import {
  listWorkOrders,
  workOrderIdsWithExpenses,
} from "@/modules/maintenance/data/work-orders";
import { workOrderAccess } from "@/modules/maintenance/data/work-order-access";
import {
  listProperties,
  propertyCategoryMap,
} from "@/modules/maintenance/data/properties";
import { userNameMap } from "@/modules/maintenance/data/users";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { EmptyState } from "@/modules/maintenance/components/ui";
import {
  WorkOrderBoard,
  WorkOrderFilteredList,
  type BoardOrder,
} from "@/modules/maintenance/components/work-order-board";
import { ClearFilterLink } from "@/modules/maintenance/components/work-order-detail-actions";

/** โหมดกรองจากแดชบอร์ด: today | urgent | no-expense */
function titleFor(
  filter: string | undefined,
  propertyName: string | null
): string {
  if (filter === "today") return "งานใหม่วันนี้";
  if (filter === "urgent") return "งานด่วน";
  if (filter === "no-expense") return "ยังไม่บันทึกค่าใช้จ่าย";
  if (propertyName) return `ใบงาน: ${propertyName}`;
  return "ใบงานทั้งหมด";
}

/** จำนวนใบรอบันทึกที่ผู้บันทึกเห็นบนบอร์ด / ทีละกี่ใบในรายการ */
const RECORDER_BOARD_LIMIT = 30;
const RECORDER_LIST_STEP = 50;

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; filter?: string; show?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderView)) redirect("/");
  const orgId = session.orgId;
  const { propertyId, filter, show } = await searchParams;

  const canCreate = hasPermission(session, MAINT_PERMS.workorderManage);
  // ใครเห็นใบไหน — กติกากลางอยู่ที่ data/work-order-access.ts (หน้ารายละเอียด
  // ใช้ตัวเดียวกัน) ผู้ดูแลบ้านต้องรู้ก่อนว่าดูแลบ้านหลังไหนบ้าง จึงต้อง await
  // ก่อนจะ query ใบงาน
  const access = await workOrderAccess(session);
  const tracking = await loadExpenseTracking(orgId);
  const trackingOn = trackingActive(tracking);

  const [allOrders, properties, expenseSet, propCats] = await Promise.all([
    listWorkOrders(orgId, {
      propertyId,
      priority: filter === "urgent" ? "urgent" : undefined,
      statuses: filter === "urgent" ? ["open", "in_progress"] : undefined,
      createdToday: filter === "today" ? true : undefined,
      access,
    }),
    listProperties(orgId),
    workOrderIdsWithExpenses(orgId),
    propertyCategoryMap(orgId),
  ]);

  // ผู้บันทึกเห็นเฉพาะใบที่ต้องทำก่อน (ผู้ใช้ 3/11/2569 "เอาที่เราจำเป็นต้องเห็น") — ใบเสี่ยงโดนหักขึ้นก่อน
  // ใบค้างเก่าที่ไม่โดนหักไปท้าย · ที่เหลือบอกจำนวนแล้วกดดูต่อ · คนอื่นเห็นเหมือนเดิม
  const recorderLimit = filter === "no-expense" ? Math.max(Number(show) || 0, RECORDER_LIST_STEP) : RECORDER_BOARD_LIMIT;
  const recorderPending = access.expensePendingIds && (!filter || filter === "no-expense") ? await pendingExpenseWorkOrders(orgId) : [];
  const visibleIds = new Set(allOrders.map((o) => o.id));
  const hiddenPending = new Set(
    recorderPending
      .filter((o) => visibleIds.has(o.id))
      .map((o) => ({ id: o.id, old: isExpenseBacklog(o, tracking), due: expenseDueAt(o, tracking).getTime() }))
      .sort((a, b) => Number(a.old) - Number(b.old) || a.due - b.due)
      .slice(recorderLimit)
      .map((o) => o.id),
  );
  const orders = allOrders.filter((o) => !hiddenPending.has(o.id));

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  // การ์ดแบบการ์ดงาน: จำนวนความคิดเห็น (ไม่นับบันทึกระบบ) + คำขอเลื่อนที่รออนุมัติ ต่อใบ
  const orderIds = orders.map((o) => o.id);
  const [commentCounts, dueReqCounts] = orderIds.length
    ? await Promise.all([
        prisma.workOrderComment.groupBy({
          by: ["workOrderId"],
          where: { workOrderId: { in: orderIds }, workOrder: { orgId }, OR: [{ kind: null }, { kind: { not: "log" } }] },
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
  const pendingClock = new Map(trackingOn ? (await pendingExpenseWorkOrders(orgId)).map((o) => [o.id, o.clockFrom] as const) : []);
  const creatorNames = await userNameMap(
    orgId,
    orders.flatMap((o) => [o.createdBy, o.assignedTo])
  );

  const rows: BoardOrder[] = orders
    .filter(
      (o) =>
        filter !== "no-expense" ||
        // ใบที่ตั้งไว้ว่าไม่ต้องกรอกค่าใช้จ่ายไม่ใช่งานค้าง — ไม่ควรโผล่ในลิสต์
        // ทวงค่าใช้จ่ายจากแดชบอร์ด (กติกาเดียวกับตัวเตือน LINE ใน data/cron.ts)
        (o.status === "completed" && o.requiresExpense && !expenseSet.has(o.id))
    )
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
      autoCreated: o.autoCreated,
      createdAtLabel: fmtThaiDate(o.createdAt),
      hasExpense: expenseSet.has(o.id),
      requiresExpense: o.requiresExpense,
      pmRound: o.pmRoundDate ? pmRoundTag(o.pmRoundDate, o.dueDate, o.status) : null,
      isPrivate: o.isPrivate,
      isPm: !!o.pmScheduleId || o.pmScheduleIds.length > 0,
      dueDateIso: o.dueDate?.toISOString() ?? null,
      expenseRecordedTotal: o.status === "completed" ? (expenseTotals.get(o.id) ?? null) : null,
      expenseDeadlineIso: pendingClock.has(o.id) ? expenseDueAt({ ...o, clockFrom: pendingClock.get(o.id) }, tracking).toISOString() : null,
      expenseHeld: trackingOn && o.status === "completed" && o.requiresExpense && !o.isPrivate && !expenseSet.has(o.id) && !pendingClock.has(o.id),
      commentCount: commentsBy.get(o.id) ?? 0,
      photoCount: o.photoUrls.length + o.afterPhotoUrls.length,
      pendingDue: dueReqBy.get(o.id) ?? 0,
      due: dueTag(o.dueDate, o.status),
    }));

  const isFilterMode = filter === "today" || filter === "urgent" || filter === "no-expense";
  const activeProp = propertyId ? (propNames[propertyId] ?? null) : null;

  return (
    <AppScaffold
      title={titleFor(filter, activeProp)}
      // บอร์ด: ไม่มีชื่อหน้ากลางแถบ ตัวกรองผู้รับผิดชอบขึ้นไปอยู่ซ้ายของแถบหัว แบบบอร์ดงาน (ผู้ใช้ 2/11/2569)
      // โหมดกรอง (งานวันนี้/งานด่วน/ยังไม่บันทึกค่าใช้จ่าย) ยังมีชื่อหน้าบอกว่ากรองอะไรอยู่
      hideTitle={!isFilterMode && rows.length > 0}
      leading={!isFilterMode && rows.length > 0 ? <div id="wo-board-toolbar" className="flex min-w-0 items-center" /> : undefined}
      fill
      actions={
        isFilterMode ? <ClearFilterLink href="/maintenance/work-orders" /> : null
      }
      fab={
        canCreate ? (
          <Fab href="/maintenance/work-orders/new" label="สร้างใบงาน" />
        ) : null
      }
    >
      {rows.length === 0 ? (
        <div className="mx-auto h-full overflow-y-auto p-4 sm:p-5">
          <EmptyState>
            {isFilterMode
              ? "ไม่พบใบงาน"
              : `ไม่มีใบงาน ${canCreate ? "— สร้างใบงานแรกได้เลย" : ""}`}
          </EmptyState>
        </div>
      ) : isFilterMode ? (
        /* โหมดกรอง = รายการเดียวเรียงตามเวลา (ไม่ใช่ Kanban) เหมือนของเดิม */
        <WorkOrderFilteredList
          orders={rows}
          propertyNames={propNames}
          creatorNames={creatorNames}
          moreCount={hiddenPending.size}
          moreHref={`/maintenance/work-orders?${new URLSearchParams({ ...(propertyId ? { propertyId } : {}), filter: "no-expense", show: String(recorderLimit + RECORDER_LIST_STEP) })}`}
        />
      ) : (
        <WorkOrderBoard
          orders={rows}
          propertyNames={propNames}
          propertyCategories={propCats}
          creatorNames={creatorNames}
          currentUserId={session.userId}
          // พนักงานทั่วไปเห็นเฉพาะใบงานของตัวเองอยู่แล้ว (work-order-access.ts) — ตัวกรองจึงมีแค่ "ของฉัน"
          canPickPeople={access.seeAll}
          expenseFirst={!!access.expensePendingIds}
          expenseMore={hiddenPending.size}
        />
      )}
    </AppScaffold>
  );
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
