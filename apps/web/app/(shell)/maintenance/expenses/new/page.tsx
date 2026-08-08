import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listWorkOrders } from "@/modules/maintenance/data/work-orders";
import { listActivePmSchedules } from "@/modules/maintenance/data/pm";
import { ExpenseForm } from "@/modules/maintenance/components/expense-form";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { createExpenseAction } from "../actions";

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

  const [orders, pms] = await Promise.all([
    listWorkOrders(session.orgId),
    listActivePmSchedules(session.orgId),
  ]);

  return (
    <AppScaffold
      title="เพิ่มค่าใช้จ่าย"
      width="max-w-2xl"
      backHref="/maintenance/expenses"
    >
      <ExpenseForm
        action={createExpenseAction}
        workOrders={orders.map((o) => ({
          id: o.id,
          title: o.title,
          propertyCount: 1 + o.additionalPropertyIds.length,
        }))}
        pmSchedules={pms.map((p) => ({ id: p.id, title: p.title }))}
        lockedWorkOrderId={workOrderId}
        lockedPmScheduleId={pmScheduleId}
      />
    </AppScaffold>
  );
}
