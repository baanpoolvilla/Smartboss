import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listWorkOrders, workOrderIdsWithExpenses } from "@/modules/maintenance/data/work-orders";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listActivePmSchedules } from "@/modules/maintenance/data/pm";
import { ExpenseForm } from "@/modules/maintenance/components/expense-form";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { createExpenseAction, createNoExpenseAction } from "../actions";

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ workOrderId?: string; pmScheduleId?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.expenseView)) redirect("/");
  const { workOrderId, pmScheduleId } = await searchParams;

  if (!hasPermission(session, MAINT_PERMS.expenseManage)) {
    return (
      <AppScaffold
        title="เพิ่มค่าใช้จ่าย"
        width="max-w-2xl"
        backHref="/maintenance/expenses"
      >
        <Card className="p-6 text-center text-sm text-(--ink-soft)">
          เฉพาะ Manager, CEO และ Super Admin เท่านั้นที่บันทึกค่าใช้จ่ายได้
        </Card>
      </AppScaffold>
    );
  }

  const [orders, pms, properties, withExpense] = await Promise.all([
    listWorkOrders(session.orgId),
    listActivePmSchedules(session.orgId),
    listProperties(session.orgId),
    workOrderIdsWithExpenses(session.orgId),
  ]);
  const houseName = new Map(properties.map((p) => [p.id, p.name]));
  /*
   * ช่องเลือกเดิมโชว์แค่ชื่องาน — ชื่อซ้ำกันทุกบ้าน ("เติมเกลือ", "ล้างแอร์ประจำปี") เลือกผิดใบ/ผิดบ้านง่าย
   * (เจอจริง: ฿180 ของ WO-0078 ไปผูก WO-0077) ⇒ ใส่เลขใบงาน + ชื่อบ้าน และเอาใบที่ปิดแล้วแต่ยังไม่บันทึก
   * ค่าใช้จ่าย (ที่ต้องกรอกจริง ๆ) ขึ้นก่อน ใบยกเลิกไม่ต้องมี
   */
  const needsExpense = (o: (typeof orders)[number]) =>
    o.status === "completed" && o.requiresExpense && !withExpense.has(o.id);
  const woOptions = orders
    .filter((o) => o.status !== "cancelled" || o.id === workOrderId)
    .sort((a, b) => Number(needsExpense(b)) - Number(needsExpense(a)))
    .map((o) => ({
      id: o.id,
      title: `${o.code} · ${houseName.get(o.propertyId) ?? "-"} · ${o.title}${needsExpense(o) ? " (ยังไม่บันทึก)" : ""}`,
      propertyCount: 1 + o.additionalPropertyIds.length,
    }));

  return (
    <AppScaffold
      title="เพิ่มค่าใช้จ่าย"
      width="max-w-2xl"
      backHref="/maintenance/expenses"
    >
      <ExpenseForm
        saveAction={createExpenseAction}
        noExpenseAction={createNoExpenseAction}
        workOrders={woOptions}
        pmSchedules={pms.map((p) => ({ id: p.id, title: `${houseName.get(p.propertyId) ?? "-"} · ${p.title}` }))}
        lockedWorkOrderId={workOrderId}
        lockedPmScheduleId={pmScheduleId}
      />
    </AppScaffold>
  );
}
