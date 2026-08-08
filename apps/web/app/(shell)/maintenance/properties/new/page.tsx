import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { PropertyForm } from "@/modules/maintenance/components/property-form";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import { createPropertyAction } from "../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

export default async function NewPropertyPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.propertyManage)) {
    redirect("/maintenance/properties");
  }
  const caretakers = await listOrgUsers(session.orgId);

  return (
    <AppScaffold
      title="เพิ่มบ้านใหม่"
      width="max-w-2xl"
      backHref="/maintenance/properties"
    >
      <PropertyForm
        action={createPropertyAction}
        caretakers={caretakers}
        submitLabel="เพิ่มบ้าน"
      />
    </AppScaffold>
  );
}
