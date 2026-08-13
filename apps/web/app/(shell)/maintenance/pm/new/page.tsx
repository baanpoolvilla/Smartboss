import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listProperties } from "@/modules/maintenance/data/properties";
import { listAssets } from "@/modules/maintenance/data/assets";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import {
  PM_FREQUENCIES,
  roundsPerYearOptions,
} from "@/modules/maintenance/lib/pm-schedule";
import { ROLE_LABEL_TH } from "@/modules/maintenance/lib/roles";
import { PmForm } from "@/modules/maintenance/components/pm-form";
import { createPmAction } from "../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

export default async function NewPmPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; assetId?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.pmManage)) redirect("/maintenance/pm");
  const sp = await searchParams;

  const [properties, assets, users] = await Promise.all([
    listProperties(session.orgId),
    listAssets(session.orgId),
    listOrgUsers(session.orgId),
  ]);
  const propNames: Record<string, string> = Object.fromEntries(
    properties.map((p) => [p.id, p.name])
  );

  return (
    <AppScaffold title="เพิ่มแผน PM" width="max-w-2xl" backHref="/maintenance/pm">
      <PmForm
        action={createPmAction}
        properties={properties.map((p) => ({ id: p.id, label: p.name }))}
        assets={assets.map((a) => ({
          id: a.id,
          name: a.name,
          propertyId: a.propertyId,
          propertyName: propNames[a.propertyId] ?? "",
        }))}
        users={users.map((u) => ({
          id: u.id,
          label: u.name,
          sub: ROLE_LABEL_TH(u.roleCodes),
        }))}
        frequencies={PM_FREQUENCIES.map((f) => ({
          value: f.value,
          label: f.label,
        }))}
        roundOptions={Object.fromEntries(
          PM_FREQUENCIES.map((f) => [f.value, roundsPerYearOptions(f.value)])
        )}
        defaultPropertyId={sp.propertyId}
        defaultAssetId={sp.assetId}
      />
    </AppScaffold>
  );
}
