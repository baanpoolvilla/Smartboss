import { redirect, notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { getOrganization } from "@/modules/admin/data/org";
import { countOrgUsers } from "@/modules/admin/data/users";
import {
  Field,
  SectionCard,
  inputClass,
} from "@/modules/admin/components/ui";
import { updateOrganizationAction } from "../actions";

export default async function AdminOrganizationPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.orgManage)) redirect("/admin");

  const [org, users] = await Promise.all([
    getOrganization(session.orgId),
    countOrgUsers(session.orgId),
  ]);
  if (!org) notFound();

  return (
    <AppScaffold title="ข้อมูลบริษัท" width="max-w-2xl">
      <div className="flex flex-col gap-4">
        <SectionCard title="ข้อมูลทั่วไป">
          <form action={updateOrganizationAction} className="flex flex-col gap-3">
            <Field label="ชื่อบริษัท *">
              <input
                name="name"
                defaultValue={org.name}
                required
                maxLength={200}
                className={inputClass}
              />
            </Field>
            <div>
              <Button type="submit" size="sm">
                บันทึก
              </Button>
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="ข้อมูลระบบ"
          description="แก้ไขได้จากผู้ดูแลแพลตฟอร์มเท่านั้น"
        >
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-(--ink-soft)">รหัสบริษัท (slug)</dt>
              <dd className="font-mono text-(--ink)">{org.slug}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-(--ink-soft)">แพ็กเกจ</dt>
              <dd className="font-medium text-(--ink)">
                {org.planCode ?? "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-(--ink-soft)">สถานะ</dt>
              <dd className="font-medium text-(--ink)">
                {org.isActive ? "ใช้งานอยู่" : "ระงับการใช้งาน"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-(--ink-soft)">จำนวนผู้ใช้</dt>
              <dd className="font-medium text-(--ink)">
                {users.active} / {users.total} คน
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-(--ink-soft)">เปิดใช้เมื่อ</dt>
              <dd className="text-(--ink)">
                {new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(
                  org.createdAt
                )}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    </AppScaffold>
  );
}
