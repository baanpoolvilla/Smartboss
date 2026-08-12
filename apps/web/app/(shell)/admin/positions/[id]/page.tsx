import { redirect, notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS, ADMIN_PERM_LABELS } from "@/modules/admin/permissions";
import { HR_PERM_LABELS } from "@/modules/hr/permissions";
import { MAINT_PERM_LABELS } from "@/modules/maintenance/permissions";
import { getPosition } from "@/modules/admin/data/positions";
import { listPermissionCatalog } from "@/modules/admin/data/permission-catalog";
import { Field, SectionCard, inputClass } from "@/modules/admin/components/ui";
import { PermissionMatrix } from "@/modules/admin/components/permission-matrix";
import { ConfirmSubmit } from "@/modules/admin/components/confirm-submit";
import {
  deletePositionAction,
  setPositionPermissionsAction,
  updatePositionAction,
} from "../../actions";

/** รวมป้ายไทยของสิทธิ์จากทุกโมดูล */
const PERM_LABELS: Record<string, string> = {
  ...ADMIN_PERM_LABELS,
  ...HR_PERM_LABELS,
  ...MAINT_PERM_LABELS,
};

export default async function PositionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.positionView)) redirect("/admin");

  const position = await getPosition(session.orgId, id);
  if (!position) notFound();

  const canEdit = hasPermission(session, ADMIN_PERMS.positionManage);
  const groups = await listPermissionCatalog();

  return (
    <AppScaffold title={position.name} width="max-w-3xl" backHref="/admin/positions">
      <div className="flex flex-col gap-4">
        <SectionCard title="ข้อมูลตำแหน่ง">
          {canEdit ? (
            <form action={updatePositionAction} className="flex flex-col gap-3">
              <input type="hidden" name="positionId" value={position.id} />
              <Field label="ชื่อตำแหน่ง *">
                <input name="name" defaultValue={position.name} required className={inputClass} />
              </Field>
              <Field label="คำอธิบาย">
                <input
                  name="description"
                  defaultValue={position.description ?? ""}
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
              {position.description && <p>{position.description}</p>}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="สิทธิ์การใช้งาน"
          description="ติ๊กสิทธิ์ที่ต้องการให้คนที่ถือตำแหน่งนี้ทำได้ (รวมกับสิทธิ์ตามบทบาทของแต่ละคน)"
        >
          <form action={setPositionPermissionsAction} className="flex flex-col gap-4">
            <input type="hidden" name="positionId" value={position.id} />
            <PermissionMatrix
              groups={groups}
              labels={PERM_LABELS}
              defaultSelected={position.permissionIds}
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
          <SectionCard title="ลบตำแหน่ง">
            <form action={deletePositionAction}>
              <input type="hidden" name="positionId" value={position.id} />
              <ConfirmSubmit
                message={`ต้องการลบตำแหน่ง "${position.name}" ใช่หรือไม่?`}
                variant="danger"
              >
                ลบตำแหน่งนี้
              </ConfirmSubmit>
            </form>
            <p className="mt-2 text-xs text-(--ink-soft)">
              ลบได้เมื่อไม่มีผู้ใช้ถือตำแหน่งนี้อยู่แล้ว
            </p>
          </SectionCard>
        )}
      </div>
    </AppScaffold>
  );
}
