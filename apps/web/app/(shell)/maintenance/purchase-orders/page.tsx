import { redirect } from "next/navigation";
import { Undo2 } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listPurchaseOrders } from "@/modules/maintenance/data/purchase-orders";
import {
  listEquipmentReturns,
  returnStatusMeta,
  RETURN_PROBLEM,
} from "@/modules/maintenance/data/equipment-returns";
import { listProperties } from "@/modules/maintenance/data/properties";
import { userNameMap } from "@/modules/maintenance/data/users";
import { workOrderCodeMap } from "@/modules/maintenance/data/work-orders";
import { poItemsFromJson, poStatusMeta } from "@/modules/maintenance/lib/po";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import {
  PoBoard,
  type BoardPo,
  type BoardReturn,
} from "@/modules/maintenance/components/po-board";
import {
  AppScaffold,
  AppBarLink,
  Fab,
} from "@/modules/maintenance/components/app-scaffold";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.poView)) redirect("/");
  const orgId = session.orgId;
  const { tab } = await searchParams;
  const canCreate = hasPermission(session, MAINT_PERMS.poCreate);

  const [orders, returns, properties] = await Promise.all([
    listPurchaseOrders(orgId),
    listEquipmentReturns(orgId),
    listProperties(orgId),
  ]);

  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );
  const [names, woCodes] = await Promise.all([
    userNameMap(orgId, [
      ...orders.flatMap((o) => [
        o.createdBy,
        o.poAssignedTo,
        o.poCreatedBy,
        o.orderedBy,
        o.receivedBy,
      ]),
      ...returns.map((r) => r.createdBy),
    ]),
    workOrderCodeMap(
      orgId,
      orders.map((o) => o.workOrderId)
    ),
  ]);

  /** เฟสล่าสุดที่ผ่านมาแล้ว (ตรงกับ _CurrentPhase เดิม) */
  function phaseOf(o: (typeof orders)[number]) {
    if (o.receivedAt)
      return {
        label: "รับของ",
        who: (o.receivedBy && names[o.receivedBy]) || "ไม่ทราบ",
        when: fmtThaiDate(o.receivedAt),
        color: "#15803D",
      };
    if (o.orderedAt)
      return {
        label: "ดำเนินการซื้อ",
        who: (o.orderedBy && names[o.orderedBy]) || "ไม่ทราบ",
        when: fmtThaiDate(o.orderedAt),
        color: "#4338CA",
      };
    if (o.poCreatedAt)
      return {
        label: "สร้าง PO",
        who: (o.poCreatedBy && names[o.poCreatedBy]) || "ไม่ทราบ",
        when: fmtThaiDate(o.poCreatedAt),
        color: "#1D4ED8",
      };
    return {
      label: "เปิด PR",
      who: (o.createdBy && names[o.createdBy]) || "ไม่ทราบ",
      when: fmtThaiDate(o.createdAt),
      color: "#C2410C",
    };
  }

  const boardOrders: BoardPo[] = orders.map((o) => {
    const meta = poStatusMeta(o.status);
    return {
      id: o.id,
      code: o.code,
      title: o.title,
      status: o.status,
      statusLabel: meta.label,
      statusColor: meta.color,
      propertyName: o.propertyId ? (propNames[o.propertyId] ?? "") : "",
      itemCount: poItemsFromJson(o.items).length,
      totalPrice: Number(o.totalPrice),
      assigneeName: o.poAssignedTo ? (names[o.poAssignedTo] ?? null) : null,
      isEmergency: o.isEmergencyPurchase,
      workOrderCode: o.workOrderId ? (woCodes[o.workOrderId]?.code ?? null) : null,
      phase: phaseOf(o),
    };
  });

  const boardReturns: BoardReturn[] = returns.map((r) => {
    const meta = returnStatusMeta(r.status);
    return {
      id: r.id,
      poTitle: r.purchaseOrder?.title ?? "PO",
      status: r.status,
      statusLabel: meta.label,
      statusColor: meta.color,
      itemLabel: r.itemName || "ทั้งรายการ",
      qty: r.qty,
      problemLabel: RETURN_PROBLEM[r.problemType] ?? r.problemType,
      propertyName: r.propertyId ? (propNames[r.propertyId] ?? "") : "",
      createdByName: (r.createdBy && names[r.createdBy]) || "ไม่ทราบ",
      createdAtLabel: fmtThaiDate(r.createdAt),
    };
  });

  return (
    <AppScaffold
      title="สั่งอุปกรณ์ (PR/PO)"
      width="max-w-[1600px]"
      actions={
        <AppBarLink
          href="/maintenance/purchase-orders/returns/new"
          label="แจ้งคืน / ของมีปัญหา"
        >
          <Undo2 className="h-5 w-5" />
        </AppBarLink>
      }
      fab={
        canCreate ? (
          <Fab href="/maintenance/purchase-orders/new" label="เปิด PR" />
        ) : null
      }
    >
      <PoBoard orders={boardOrders} returns={boardReturns} initialTab={tab} />
    </AppScaffold>
  );
}
