import { redirect, notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { PropertyForm } from "@/modules/maintenance/components/property-form";
import { listOrgUsers } from "@/modules/maintenance/data/users";
import { getProperty } from "@/modules/maintenance/data/properties";
import { listCategories } from "@/modules/maintenance/data/categories";
import { updatePropertyAction } from "../../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.propertyManage)) {
    redirect("/maintenance/properties");
  }
  const [property, caretakers, categories] = await Promise.all([
    getProperty(session.orgId, id),
    listOrgUsers(session.orgId),
    listCategories(session.orgId),
  ]);
  if (!property) notFound();

  const action = updatePropertyAction.bind(null, id);

  return (
    <AppScaffold
      title="แก้ไขบ้าน"
      width="max-w-2xl"
      backHref={`/maintenance/properties/${id}`}
    >
      <PropertyForm
        action={action}
        caretakers={caretakers}
        categories={categories}
        submitLabel="บันทึก"
        defaults={{
          name: property.name,
          caretakerId: property.caretakerId,
          address: property.address,
          ownerName: property.ownerName,
          ownerContact: property.ownerContact,
          notes: property.notes,
          categoryId: property.categoryId,
        }}
      />
    </AppScaffold>
  );
}
