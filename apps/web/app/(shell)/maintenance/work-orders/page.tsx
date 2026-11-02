import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
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

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; filter?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.workorderView)) redirect("/");
  const orgId = session.orgId;
  const { propertyId, filter } = await searchParams;

  const canCreate = hasPermission(session, MAINT_PERMS.workorderManage);
  // ใครเห็นใบไหน — กติกากลางอยู่ที่ data/work-order-access.ts (หน้ารายละเอียด
  // ใช้ตัวเดียวกัน) ผู้ดูแลบ้านต้องรู้ก่อนว่าดูแลบ้านหลังไหนบ้าง จึงต้อง await
  // ก่อนจะ query ใบงาน
  const access = await workOrderAccess(session);

  const [orders, properties, expenseSet, propCats] = await Promise.all([
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

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  // ชื่อทั้งผู้เปิดและผู้ได้รับมอบหมาย — ใช้ตารางเดียวกัน (การ์ด + ตัวกรองผู้รับผิดชอบ)
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
      due: dueTag(o.dueDate, o.status),
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
