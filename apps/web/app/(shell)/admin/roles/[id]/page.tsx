import { redirect, notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import {
  ADMIN_PERMS,
  ADMIN_PERM_LABELS,
} from "@/modules/admin/permissions";
import { HR_PERM_LABELS } from "@/modules/hr/permissions";
import { MAINT_PERM_LABELS } from "@/modules/maintenance/permissions";
import { getRole, listPermissionCatalog } from "@/modules/admin/data/roles";
import {
  Field,
  Pill,
  SectionCard,
  inputClass,
} from "@/modules/admin/components/ui";
import { PermissionMatrix } from "@/modules/admin/components/permission-matrix";
import { ConfirmSubmit } from "@/modules/admin/components/confirm-submit";
import {
  deleteRoleAction,
  setRolePermissionsAction,
  updateRoleAction,
} from "../../actions";

/** รวมป้ายไทยของสิทธิ์จากทุกโมดูล */
const PERM_LABELS: Record<string, string> = {
  ...ADMIN_PERM_LABELS,
  ...HR_PERM_LABELS,
  ...MAINT_PERM_LABELS,
};

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.roleView)) redirect("/admin");

  const role = await getRole(session.orgId, id);
  if (!role) notFound();

  // role ระบบดูได้อย่างเดียว
  const canEdit =
    hasPermission(session, ADMIN_PERMS.roleManage) && !role.isSystem;
  const groups = await listPermissionCatalog();

  return (
    <AppScaffold title={role.name} width="max-w-3xl" backHref="/admin/roles">
      <div className="flex flex-col gap-4">
        <SectionCard title="ข้อมูลบทบาท">
          {role.isSystem && (
            <p className="mb-3 flex items-center gap-2 text-xs text-(--ink-soft)">
              <Pill color="#9E9E9E">
                <Lock className="h-3 w-3" /> บทบาทระบบ
              </Pill>
              เข้าถึงได้ทุกอย่างโดยไม่ต้องกำหนดสิทธิ์รายข้อ และแก้ไขจากหลังบ้านไม่ได้
            </p>
          )}

          {canEdit ? (
            <form action={updateRoleAction} className="flex flex-col gap-3">
              <input type="hidden" name="roleId" value={role.id} />
              <Field label="ชื่อบทบาท *">
                <input
                  name="name"
                  defaultValue={role.name}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="คำอธิบาย">
                <input
                  name="description"
                  defaultValue={role.description ?? ""}
                  className={inputClass}
                />
              </Field>
              <p className="text-xs text-(--ink-soft)">
                รหัสบทบาท: <span className="font-mono">{role.code}</span>{" "}
                (เปลี่ยนไม่ได้)
              </p>
              <div>
                <Button type="submit" size="sm">
                  บันทึก
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-(--ink)">
              <p className="font-mono text-xs text-(--ink-soft)">
                {role.code}
              </p>
              {role.description && <p className="mt-1">{role.description}</p>}
            </div>
          )}
        </SectionCard>

        {/* ─── สิทธิ์ ─── */}
        <SectionCard
          title="สิทธิ์การใช้งาน"
          description={
            role.isSystem
              ? "บทบาทระบบข้ามการตรวจสิทธิ์ทุกข้ออยู่แล้ว"
              : "ติ๊กสิทธิ์ที่ต้องการให้บทบาทนี้ทำได้"
          }
        >
          {role.isSystem ? (
            <p className="text-sm text-(--ink-soft)">
              ไม่ต้องกำหนด — เข้าถึงได้ทั้งหมด
            </p>
          ) : (
            <form action={setRolePermissionsAction} className="flex flex-col gap-4">
              <input type="hidden" name="roleId" value={role.id} />
              <PermissionMatrix
                groups={groups}
                labels={PERM_LABELS}
                defaultSelected={role.permissionIds}
                readOnly={!canEdit}
              />
              {canEdit && (
                <div>
                  <Button type="submit">บันทึกสิทธิ์</Button>
                </div>
              )}
            </form>
          )}
        </SectionCard>

        {canEdit && (
          <SectionCard title="ลบบทบาท">
            <form action={deleteRoleAction}>
              <input type="hidden" name="roleId" value={role.id} />
              <ConfirmSubmit
                message={`ต้องการลบบทบาท "${role.name}" ใช่หรือไม่?`}
                variant="danger"
              >
                ลบบทบาทนี้
              </ConfirmSubmit>
            </form>
            <p className="mt-2 text-xs text-(--ink-soft)">
              ลบได้เมื่อไม่มีผู้ใช้ถือบทบาทนี้อยู่
            </p>
          </SectionCard>
        )}
      </div>
    </AppScaffold>
  );
}
