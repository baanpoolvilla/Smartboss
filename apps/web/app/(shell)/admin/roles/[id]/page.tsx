import Link from "next/link";
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
import { getRole, listPermissionCatalog, listRoleHolders } from "@/modules/admin/data/roles";
import { listDepartments } from "@/modules/admin/data/departments";
import {
  Field,
  Pill,
  SectionCard,
  inputClass,
  selectClass,
} from "@/modules/admin/components/ui";
import { PermissionMatrix } from "@/modules/admin/components/permission-matrix";
import { ConfirmSubmit } from "@/modules/admin/components/confirm-submit";
import {
  addRoleHeadAction,
  deleteRoleAction,
  removeRoleHeadAction,
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
  const departments = role.isSystem ? [] : await listDepartments(session.orgId);
  const canManageDept = hasPermission(session, ADMIN_PERMS.departmentManage);
  const holders =
    !role.isSystem && role.departmentId ? await listRoleHolders(session.orgId, role.id) : [];

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
              <Field
                label="แผนกที่เกี่ยวข้อง"
                hint="ไม่บังคับ — แค่จัดกลุ่ม/ทางลัดตั้งหัวหน้าแผนก ไม่มีผลต่อสิทธิ์การใช้งาน"
              >
                <select name="departmentId" defaultValue={role.departmentId ?? ""} className={selectClass}>
                  <option value="">ไม่ระบุ (role ใช้ข้ามแผนก เช่น ADMIN/MANAGER)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-xs text-(--ink-soft)">
                ไม่เจอแผนกที่ต้องการ?{" "}
                <Link href="/admin/departments/new" className="underline">
                  สร้างแผนกใหม่
                </Link>{" "}
                แล้วกลับมาเลือกที่นี่
              </p>
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

        {/* ─── ทางลัดตั้งหัวหน้าแผนก (เฉพาะ role ที่ผูกแผนกไว้) ─── */}
        {role.departmentId && (
          <SectionCard
            title={`หัวหน้าแผนก${departments.find((d) => d.id === role.departmentId)?.name ?? ""}`}
            description="ตั้งจากคนที่ถือบทบาทนี้อยู่ — ครั้งเดียว ไม่ผูกถาวรกับบทบาท ถอดบทบาทออกทีหลังไม่กระทบสถานะหัวหน้าแผนกที่ตั้งไปแล้ว"
          >
            {holders.length === 0 ? (
              <p className="text-sm text-(--ink-soft)">ยังไม่มีใครถือบทบาทนี้</p>
            ) : (
              <div className="flex flex-col gap-2">
                {holders.map((u) => {
                  const isHead = u.headOfDepartmentIds.includes(role.departmentId!);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-3 rounded-(--radius) border border-(--line) p-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-(--ink)">{u.name}</p>
                        <p className="truncate text-xs text-(--ink-soft)">{u.email}</p>
                      </div>
                      {canManageDept ? (
                        <form action={isHead ? removeRoleHeadAction : addRoleHeadAction}>
                          <input type="hidden" name="roleId" value={role.id} />
                          <input type="hidden" name="departmentId" value={role.departmentId!} />
                          <input type="hidden" name="userId" value={u.id} />
                          <Button type="submit" size="sm" variant={isHead ? "outline" : "primary"}>
                            {isHead ? "เอาออกจากหัวหน้า" : "ตั้งเป็นหัวหน้า"}
                          </Button>
                        </form>
                      ) : (
                        isHead && <Pill color="#1B2537">หัวหน้าแผนก</Pill>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}

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
