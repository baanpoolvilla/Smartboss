import { redirect } from "next/navigation";
import { loadExpenseTracking, pendingExpenseWorkOrders } from "@/modules/maintenance/data/expense-tracking";
import { expenseDueAt, isExpenseBacklog } from "@/modules/maintenance/lib/expense-deadline";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { AppScaffold, Fab } from "@/modules/maintenance/components/app-scaffold";
import {
  listWorkOrders,
  listWorkOrderStubs,
  workOrderIdsWithExpenses,
} from "@/modules/maintenance/data/work-orders";
import { workOrderAccess } from "@/modules/maintenance/data/work-order-access";
import {
  listProperties,
  propertyCategoryMap,
} from "@/modules/maintenance/data/properties";
import { userNameMap } from "@/modules/maintenance/data/users";
import { buildBoardRows } from "@/modules/maintenance/data/work-order-board-rows";
import { loadDoneWorkOrderCardsAction } from "./actions";
import { EmptyState } from "@/modules/maintenance/components/ui";
import {
  WorkOrderBoard,
  WorkOrderFilteredList,
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
/** การ์ดเสร็จแล้วที่ส่งมาพร้อมหน้า เท่ากับที่คอลัมน์แสดงก่อนกดเพิ่มเติม */
const DONE_PRELOAD = 10;

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; filter?: string; show?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderView)) redirect("/");
  const orgId = session.orgId;
  const { propertyId, filter, show } = await searchParams;
  const isFilterMode = filter === "today" || filter === "urgent" || filter === "no-expense";

  const canCreate = hasPermission(session, MAINT_PERMS.workorderManage);
  // ใครเห็นใบไหน — กติกากลางอยู่ที่ data/work-order-access.ts (หน้ารายละเอียด
  // ใช้ตัวเดียวกัน) ผู้ดูแลบ้านต้องรู้ก่อนว่าดูแลบ้านหลังไหนบ้าง จึงต้อง await
  // ก่อนจะ query ใบงาน
  const access = await workOrderAccess(session);
  const tracking = await loadExpenseTracking(orgId);

  const [stubs, properties, expenseSet, propCats] = await Promise.all([
    isFilterMode ? Promise.resolve([]) : listWorkOrderStubs(orgId, { propertyId, access }),
    listProperties(orgId),
    workOrderIdsWithExpenses(orgId),
    propertyCategoryMap(orgId),
  ]);
  // บอร์ด: คอลัมน์เสร็จแล้วมีได้เป็นพันใบ ส่งแค่แถวเบาไว้นับ/กรอง การ์ดโหลดตอนกดแสดงเพิ่มเติม (ผู้ใช้ 4/11/2569 "โหลดข้อมูลนานเกิน")
  const isDone = (o: { id: string; status: string; requiresExpense: boolean; reviewState: string }) =>
    o.status === "cancelled" || (o.status === "completed" && o.reviewState !== "pending" && (expenseSet.has(o.id) || !o.requiresExpense));
  const doneStubRows = stubs.filter(isDone);
  const doneFirstIds = new Set(doneStubRows.slice(0, DONE_PRELOAD).map((o) => o.id));
  const allOrders = await listWorkOrders(
    orgId,
    isFilterMode
      ? {
          propertyId,
          priority: filter === "urgent" ? "urgent" : undefined,
          statuses: filter === "urgent" ? ["open", "in_progress"] : undefined,
          createdToday: filter === "today" ? true : undefined,
          access,
        }
      : { propertyId, access, ids: stubs.filter((o) => !isDone(o) || doneFirstIds.has(o.id)).map((o) => o.id) },
  );

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
  const creatorNames = await userNameMap(
    orgId,
    [...orders, ...doneStubRows].flatMap((o) => [o.createdBy, o.assignedTo, ...o.groupMemberIds])
  );

  const builtRows = await buildBoardRows(
    orgId,
    orders.filter(
      (o) =>
        filter !== "no-expense" ||
        // ใบที่ตั้งไว้ว่าไม่ต้องกรอกค่าใช้จ่ายไม่ใช่งานค้าง — ไม่ควรโผล่ในลิสต์
        // ทวงค่าใช้จ่ายจากแดชบอร์ด (กติกาเดียวกับตัวเตือน LINE ใน data/cron.ts)
        (o.status === "completed" && o.reviewState !== "pending" && o.requiresExpense && !expenseSet.has(o.id))
    ),
    expenseSet,
    tracking,
    session.userId,
  );

  const rows = builtRows.filter((o) => !doneFirstIds.has(o.id));
  const doneFirst = builtRows.filter((o) => doneFirstIds.has(o.id));
  const doneStubs = doneStubRows.map((o) => ({
    id: o.id,
    code: o.code,
    title: o.title,
    propertyId: o.propertyId,
    additionalPropertyIds: o.additionalPropertyIds,
    assignedTo: o.assignedTo,
    groupMemberIds: o.groupMemberIds,
    createdBy: o.createdBy,
  }));
  const hasRows = rows.length + doneStubs.length > 0;
  const activeProp = propertyId ? (propNames[propertyId] ?? null) : null;

  return (
    <AppScaffold
      title={titleFor(filter, activeProp)}
      // บอร์ด: ไม่มีชื่อหน้ากลางแถบ ตัวกรองผู้รับผิดชอบขึ้นไปอยู่ซ้ายของแถบหัว แบบบอร์ดงาน (ผู้ใช้ 2/11/2569)
      // โหมดกรอง (งานวันนี้/งานด่วน/ยังไม่บันทึกค่าใช้จ่าย) ยังมีชื่อหน้าบอกว่ากรองอะไรอยู่
      hideTitle={!isFilterMode && hasRows}
      leading={!isFilterMode && hasRows ? <div id="wo-board-toolbar" className="flex min-w-0 items-center" /> : undefined}
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
      {!hasRows ? (
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
          doneStubs={doneStubs}
          doneFirst={doneFirst}
          loadDoneCards={loadDoneWorkOrderCardsAction}
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
