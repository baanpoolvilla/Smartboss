import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { AppScaffold, Fab } from "@/modules/maintenance/components/app-scaffold";
import {
  listWorkOrders,
  workOrderIdsWithExpenses,
} from "@/modules/maintenance/data/work-orders";
import { listProperties } from "@/modules/maintenance/data/properties";
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

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; filter?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderView)) redirect("/");
  const orgId = session.orgId;
  const { propertyId, filter } = await searchParams;

  const seeAll = hasPermission(session, MAINT_PERMS.workorderManage);
  const canCreate = hasPermission(session, MAINT_PERMS.workorderManage);

  const [orders, properties, expenseSet] = await Promise.all([
    listWorkOrders(orgId, {
      propertyId,
      priority: filter === "urgent" ? "urgent" : undefined,
      statuses: filter === "urgent" ? ["open", "in_progress"] : undefined,
      createdToday: filter === "today" ? true : undefined,
      restrictUserId: seeAll ? undefined : session.userId,
    }),
    listProperties(orgId),
    workOrderIdsWithExpenses(orgId),
  ]);

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const creatorNames = await userNameMap(
    orgId,
    orders.map((o) => o.createdBy)
  );

  const rows: BoardOrder[] = orders
    .filter(
      (o) =>
        filter !== "no-expense" ||
        (o.status === "completed" && !expenseSet.has(o.id))
    )
    .map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      status: o.status,
      priority: o.priority,
      propertyId: o.propertyId,
      additionalPropertyIds: o.additionalPropertyIds,
      createdBy: o.createdBy,
      autoCreated: o.autoCreated,
      createdAtLabel: fmtThaiDate(o.createdAt),
      hasExpense: expenseSet.has(o.id),
    }));

  const isFilterMode = filter === "today" || filter === "urgent" || filter === "no-expense";
  const activeProp = propertyId ? (propNames[propertyId] ?? null) : null;

  return (
    <AppScaffold
      title={titleFor(filter, activeProp)}
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
        <div className="mx-auto max-w-4xl p-4 sm:p-5">
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
        />
      ) : (
        <WorkOrderBoard
          orders={rows}
          propertyNames={propNames}
          creatorNames={creatorNames}
        />
      )}
    </AppScaffold>
  );
}
