import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listProperties, getProperty } from "@/modules/maintenance/data/properties";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import { getWorkOrder } from "@/modules/maintenance/data/work-orders";
import {
  PoForm,
  type LinkedWorkOrder,
} from "@/modules/maintenance/components/po-form";
import { ROLE_LABEL_TH } from "@/modules/maintenance/lib/roles";
import { createPoAction } from "../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

export default async function NewPoPage({
  searchParams,
}: {
  searchParams: Promise<{ workOrderId?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.poCreate)) {
    redirect("/maintenance/purchase-orders");
  }
  // role สูง (อนุมัติได้) เปิด PO ได้เลยโดยไม่ต้องรออนุมัติ
  const canOpenPo = hasPermission(session, MAINT_PERMS.poApprove);
  const { workOrderId } = await searchParams;

  const [properties, users, wo] = await Promise.all([
    listProperties(session.orgId),
    listOrgUsers(session.orgId),
    // getWorkOrder กรอง orgId ให้แล้ว — id ของบริษัทอื่นจะได้ null ไม่ใช่ข้อมูลรั่ว
    workOrderId
      ? getWorkOrder(session.orgId, workOrderId)
      : Promise.resolve(null),
  ]);

  /**
   * ใบงานที่คนคนนี้เข้าถึงได้จริง — เกณฑ์เดียวกับหน้ารายละเอียดใบงาน
   * (ช่างเห็นเฉพาะงานที่ได้รับมอบหรือสร้างเอง) ถ้าไม่ผ่านก็แค่ไม่ผูก
   * ไม่ต้องเด้งออก เพราะเปิด PR ลอย ๆ ยังเป็นสิ่งที่เขาทำได้อยู่แล้ว
   */
  const canSeeAllWo = hasPermission(session, MAINT_PERMS.workorderManage);
  const linkable =
    wo &&
    (canSeeAllWo ||
      wo.assignedTo === session.userId ||
      wo.createdBy === session.userId)
      ? wo
      : null;

  const woProperty = linkable
    ? await getProperty(session.orgId, linkable.propertyId)
    : null;
  const linked: LinkedWorkOrder | null = linkable
    ? {
        id: linkable.id,
        code: linkable.code,
        title: linkable.title,
        propertyName: woProperty?.name ?? "",
      }
    : null;

  return (
    <AppScaffold
      title={linked ? `เปิด PR / PO — ${linked.code}` : "เปิด PR / PO"}
      width="max-w-2xl"
      backHref={
        linked
          ? `/maintenance/work-orders/${linked.id}`
          : "/maintenance/purchase-orders"
      }
    >
      <PoForm
        action={createPoAction}
        canOpenPo={canOpenPo}
        workOrder={linked}
        properties={properties.map((p) => ({ id: p.id, label: p.name }))}
        users={users.map((u) => ({
          id: u.id,
          label: u.name,
          sub: ROLE_LABEL_TH(u.roleCodes),
        }))}
      />
    </AppScaffold>
  );
}
