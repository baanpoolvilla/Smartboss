import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Users } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold, Fab } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { listDepartments } from "@/modules/admin/data/departments";
import { Pill } from "@/modules/admin/components/ui";

export default async function AdminDepartmentsPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.departmentView)) redirect("/admin");
  const canManage = hasPermission(session, ADMIN_PERMS.departmentManage);

  const departments = await listDepartments(session.orgId);

  return (
    <AppScaffold
      title="แผนก"
      width="max-w-3xl"
      fab={canManage ? <Fab href="/admin/departments/new" label="สร้างแผนก" /> : null}
    >
      <p className="mb-4 text-sm text-(--ink-soft)">
        แผนกเป็นของกลาง ใช้ร่วมกันได้ทุกโมดูล — กำหนดสิทธิ์ระดับแผนกได้เหมือนบทบาท
        คนในแผนกจะได้สิทธิ์นี้เพิ่มจากบทบาทของตัวเอง
      </p>

      {departments.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีแผนก
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {departments.map((d) => (
            <Link key={d.id} href={`/admin/departments/${d.id}`}>
              <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-(--bg-soft)">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-(--ink)">{d.name}</p>
                  {d.description && (
                    <p className="truncate text-xs text-(--ink-soft)">{d.description}</p>
                  )}
                </div>
                <Pill color="#3B82F6">
                  <Users className="h-3 w-3" /> {d.userCount}
                </Pill>
                <Pill color="#0D9488">{d.permissionCount} สิทธิ์</Pill>
                <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
