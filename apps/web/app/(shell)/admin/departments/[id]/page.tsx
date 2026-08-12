import { redirect, notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS, ADMIN_PERM_LABELS } from "@/modules/admin/permissions";
import { HR_PERM_LABELS } from "@/modules/hr/permissions";
import { MAINT_PERM_LABELS } from "@/modules/maintenance/permissions";
import { getDepartment } from "@/modules/admin/data/departments";
import { listPermissionCatalog } from "@/modules/admin/data/permission-catalog";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import { PermissionMatrix } from "@/modules/admin/components/permission-matrix";
import { ConfirmSubmit } from "@/modules/admin/components/confirm-submit";
import {
  deleteDepartmentAction,
  setDepartmentPermissionsAction,
  updateDepartmentAction,
} from "../../actions";

/** รวมป้ายไทยของสิทธิ์จากทุกโมดูล */
const PERM_LABELS: Record<string, string> = {
  ...ADMIN_PERM_LABELS,
  ...HR_PERM_LABELS,
  ...MAINT_PERM_LABELS,
};

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.departmentView)) redirect("/admin");

  const department = await getDepartment(session.orgId, id);
  if (!department) notFound();

  const canEdit = hasPermission(session, ADMIN_PERMS.departmentManage);
  const groups = await listPermissionCatalog();

  return (
    <AppScaffold title={department.name} width="max-w-3xl" backHref="/admin/departments">
      <div className="flex flex-col gap-4">
        <SectionCard title="ข้อมูลแผนก">
          {canEdit ? (
            <form action={updateDepartmentAction} className="flex flex-col gap-3">
              <input type="hidden" name="departmentId" value={department.id} />
              <Field label="ชื่อแผนก *">
                <input name="name" defaultValue={department.name} required className={inputClass} />
              </Field>
              <Field label="คำอธิบาย">
                <input
                  name="description"
                  defaultValue={department.description ?? ""}
                  className={inputClass}
                />
              </Field>
              <div>
                <Button type="submit" size="sm">
                  บันทึก
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-(--ink)">
              {department.description && <p>{department.description}</p>}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="สิทธิ์การใช้งาน"
          description="ติ๊กสิทธิ์ที่ต้องการให้คนในแผนกนี้ทำได้ (รวมกับสิทธิ์ตามบทบาทของแต่ละคน)"
        >
          <form action={setDepartmentPermissionsAction} className="flex flex-col gap-4">
            <input type="hidden" name="departmentId" value={department.id} />
            <PermissionMatrix
              groups={groups}
              labels={PERM_LABELS}
              defaultSelected={department.permissionIds}
              readOnly={!canEdit}
            />
            {canEdit && (
              <div>
                <Button type="submit">บันทึกสิทธิ์</Button>
              </div>
            )}
          </form>
        </SectionCard>

        {canEdit && (
          <SectionCard title="ลบแผนก">
            <form action={deleteDepartmentAction}>
              <input type="hidden" name="departmentId" value={department.id} />
              <ConfirmSubmit
                message={`ต้องการลบแผนก "${department.name}" ใช่หรือไม่?`}
                variant="danger"
              >
                ลบแผนกนี้
              </ConfirmSubmit>
            </form>
            <p className="mt-2 text-xs text-(--ink-soft)">
              ลบได้เมื่อไม่มีผู้ใช้อยู่แผนกนี้แล้ว
            </p>
          </SectionCard>
        )}
      </div>
    </AppScaffold>
  );
}
