import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listPurchaseOrders } from "@/modules/maintenance/data/purchase-orders";
import { poItemsFromJson } from "@/modules/maintenance/lib/po";
import { ReturnForm } from "@/modules/maintenance/components/return-form";
import { createReturnAction } from "../../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.poView)) redirect("/");
  const { poId } = await searchParams;

  // เลือกได้เฉพาะรายการที่ผ่านการอนุมัติ/ซื้อ/รับของแล้ว (เหมือนของเดิม)
  const all = await listPurchaseOrders(session.orgId);
  const pos = all
    .filter((o) => ["approved", "ordered", "received"].includes(o.status))
    .map((o) => ({
      id: o.id,
      title: o.title,
      items: poItemsFromJson(o.items).map((i) => i.name),
    }));

  return (
    <AppScaffold
      title="แจ้งคืนของ / ของมีปัญหา"
      width="max-w-2xl"
      backHref="/maintenance/purchase-orders"
    >
      <ReturnForm action={createReturnAction} pos={pos} initialPoId={poId} />
    </AppScaffold>
  );
}
