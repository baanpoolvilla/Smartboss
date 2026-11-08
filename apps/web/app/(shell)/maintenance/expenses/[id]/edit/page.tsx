import { notFound, redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { getExpense } from "@/modules/maintenance/data/expenses";
import { getWorkOrder } from "@/modules/maintenance/data/work-orders";
import { getProperty } from "@/modules/maintenance/data/properties";
import { expenseHasSource } from "@/modules/maintenance/data/expense-tracking";
import { ExpenseForm } from "@/modules/maintenance/components/expense-form";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";
import { createNoExpenseAction, updateExpenseAction } from "../../actions";
import { loadSettings as loadRequestSettings } from "@/modules/requests/lib/data";

/** YYYY-MM-DDTHH:mm เวลาไทย — ค่าของ input datetime-local */
const toLocalInput = (d: Date | null) => (d ? new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 16) : "");

/** แก้รายการค่าใช้จ่ายที่บันทึกแล้ว (ผู้ใช้ 3/11/2569 "ใบไหนบันทึกเสร็จ เพื่อเค้ามาแก้") */
export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.expenseManage)) redirect("/maintenance/expenses");
  const e = await getExpense(session.orgId, id);
  if (!e) notFound();
  const wo = e.workOrderId ? await getWorkOrder(session.orgId, e.workOrderId) : null;
  if (expenseHasSource(e)) redirect(wo ? `/maintenance/work-orders/${wo.id}` : "/maintenance/expenses");
  const house = wo ? await getProperty(session.orgId, wo.propertyId) : null;
  const returnTo = wo ? `/maintenance/work-orders/${wo.id}` : "/maintenance/expenses";
  const reqSettings = await loadRequestSettings(session.orgId);

  return (
    <AppScaffold title="แก้ไขค่าใช้จ่าย" width="max-w-none" backHref={returnTo}>
      <ExpenseForm
        saveAction={updateExpenseAction}
        noExpenseAction={createNoExpenseAction}
        workOrders={wo ? [{ id: wo.id, title: `${wo.code} · ${house?.name ?? "-"} · ${wo.title}`, propertyCount: 1 + wo.additionalPropertyIds.length }] : []}
        pmSchedules={[]}
        lockedWorkOrderId={wo?.id}
        returnTo={returnTo}
        edit={{
          id: e.id,
          amount: String(Number(e.amount)),
          description: e.description ?? "",
          paidBy: e.paidBy,
          receiptUrl: e.receiptUrl,
          receiptNo: e.receiptNo ?? "",
          payee: e.payee ?? "",
          payer: e.payer ?? "",
          paidAt: toLocalInput(e.paidAt),
          paymentMethod: e.paymentMethod ?? "",
          noReceipt: e.noReceipt,
          costKind: e.costKind === "goods" || e.costKind === "service" ? e.costKind : null,
          payeeKind: e.payeeKind === "person" || e.payeeKind === "company" ? e.payeeKind : null,
          vatIncluded: Number(e.vatAmount ?? 0) > 0,
          whtPercent: e.whtPercent === null ? null : Number(e.whtPercent),
        }}
        tax={{ vatPercent: reqSettings.vatPercent, whtRates: reqSettings.whtRates.filter((r) => r > 0) }}
      />
    </AppScaffold>
  );
}
