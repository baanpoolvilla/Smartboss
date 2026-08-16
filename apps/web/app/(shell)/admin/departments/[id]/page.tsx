import { redirect, notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { getDepartment } from "@/modules/admin/data/departments";
import { listOrgUsers } from "@/modules/admin/data/users";
import { Field, SectionCard, inputClass, selectClass, Pill } from "@/modules/admin/components/ui";
import { ConfirmSubmit } from "@/modules/admin/components/confirm-submit";
import {
  addDepartmentHeadAction,
  deleteDepartmentAction,
  removeDepartmentHeadAction,
  updateDepartmentAction,
} from "../../actions";

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
  const users = await listOrgUsers(session.orgId);
  const headUserIds = new Set(department.heads.map((h) => h.userId));
  const candidateUsers = users.filter((u) => u.isActive && !headUserIds.has(u.id));

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
          title="หัวหน้าแผนก"
          description="หัวหน้าแผนกเห็น/แก้ข้อมูล (งาน รีพอต ฯลฯ) ของทุกคนในแผนกนี้ได้ — คนละเรื่องกับสิทธิ์เมนูที่มาจากบทบาท แผนกหนึ่งมีหัวหน้าได้หลายคน"
        >
          {department.heads.length === 0 ? (
            <p className="text-sm text-(--ink-soft)">ยังไม่มีหัวหน้าแผนก</p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              {department.heads.map((h) => (
                <Pill key={h.userId} color="#1B2537">
                  {h.name}
                  {canEdit && (
                    <form action={removeDepartmentHeadAction} className="inline">
                      <input type="hidden" name="departmentId" value={department.id} />
                      <input type="hidden" name="userId" value={h.userId} />
                      <button
                        type="submit"
                        className="ml-1 text-(--ink-soft) hover:text-(--ink)"
                        aria-label={`เอา ${h.name} ออกจากหัวหน้าแผนก`}
                      >
                        ×
                      </button>
                    </form>
                  )}
                </Pill>
              ))}
            </div>
          )}

          {canEdit && candidateUsers.length > 0 && (
            <form action={addDepartmentHeadAction} className="flex items-end gap-2">
              <input type="hidden" name="departmentId" value={department.id} />
              <div className="flex-1">
                <Field label="เพิ่มหัวหน้าแผนก">
                  <select name="userId" required className={selectClass}>
                    <option value="">เลือกคนในบริษัท</option>
                    {candidateUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Button type="submit" size="sm">
                เพิ่ม
              </Button>
            </form>
          )}
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
