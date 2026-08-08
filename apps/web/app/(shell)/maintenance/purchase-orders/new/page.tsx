import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import { PoForm } from "@/modules/maintenance/components/po-form";
import { ROLE_LABEL_TH } from "@/modules/maintenance/lib/roles";
import { createPoAction } from "../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

export default async function NewPoPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.poCreate)) {
    redirect("/maintenance/purchase-orders");
  }
  // role สูง (อนุมัติได้) เปิด PO ได้เลยโดยไม่ต้องรออนุมัติ
  const canOpenPo = hasPermission(session, MAINT_PERMS.poApprove);

  const [properties, users] = await Promise.all([
    listProperties(session.orgId),
    listOrgUsers(session.orgId),
  ]);

  return (
    <AppScaffold
      title="เปิด PR / PO"
      width="max-w-2xl"
      backHref="/maintenance/purchase-orders"
    >
      <PoForm
        action={createPoAction}
        canOpenPo={canOpenPo}
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
