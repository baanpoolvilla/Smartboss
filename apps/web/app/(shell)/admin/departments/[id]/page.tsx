import { redirect, notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { getDepartment, getReportTaskDepartmentHeadId } from "@/modules/admin/data/departments";
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

  // listOrgUsers/getReportTaskDepartmentHeadId ไม่ขึ้นกับ department เลย ยิง
  // คู่ขนานไปพร้อมกันได้
  const [department, users, reportTaskHeadId] = await Promise.all([
    getDepartment(session.orgId, id),
    listOrgUsers(session.orgId),
    getReportTaskDepartmentHeadId(session.orgId, id),
  ]);
  if (!department) notFound();

  const canEdit = hasPermission(session, ADMIN_PERMS.departmentManage);
  const headUserIds = new Set(department.heads.map((h) => h.userId));
  const candidateUsers = users.filter((u) => u.isActive && !headUserIds.has(u.id));

  // แค่เตือน ไม่บังคับให้ตรงกัน — สองระบบนี้ตั้งใจแยกกันตอนนี้ (ดูคอมเมนต์ที่
  // getReportTaskDepartmentHeadId) แต่ถ้าตั้งไว้คนละคน ควรมีใครสักคนรู้
  const reportTaskHeadMismatch =
    reportTaskHeadId && !headUserIds.has(reportTaskHeadId)
      ? (users.find((u) => u.id === reportTaskHeadId)?.name ?? "ผู้ใช้ที่ไม่พบแล้ว")
      : null;

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
          description="กำหนดขอบเขตข้อมูล (data scope) ของแผนกนี้ไว้สำหรับโมดูลที่รองรับ — คนละเรื่องกับสิทธิ์เมนูที่มาจากบทบาท แผนกหนึ่งมีหัวหน้าได้หลายคน ปัจจุบันยังไม่มีโมดูลไหนอ่านค่านี้โดยตรง (โมดูลรายงานและงานใช้ตัวตั้งหัวหน้าแผนกของตัวเองแยกต่างหากที่หน้าตั้งค่าโมดูล)"
        >
          {reportTaskHeadMismatch && (
            <p className="mb-3 rounded-md border border-(--warn)/30 bg-(--warn)/5 p-2.5 text-xs text-(--ink)">
              โมดูล &quot;รายงานและงาน&quot; ตั้งหัวหน้าแผนกนี้ไว้เป็นคนละคน (
              <span className="font-medium">{reportTaskHeadMismatch}</span>) ที่หน้าตั้งค่าโมดูล — สองระบบนี้ไม่ sync
              กันอัตโนมัติ ตั้งให้ตรงกันเองถ้าต้องการให้สอดคล้องกัน
            </p>
          )}
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
              ลบได้เมื่อไม่มีผู้ใช้และไม่มีหัวหน้าแผนกอยู่แล้ว
            </p>
          </SectionCard>
        )}
      </div>
    </AppScaffold>
  );
}
