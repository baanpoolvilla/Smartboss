import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Lock, Users } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold, Fab } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { listRoles } from "@/modules/admin/data/roles";
import { Pill } from "@/modules/admin/components/ui";

export default async function AdminRolesPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.roleView)) redirect("/admin");
  const canManage = hasPermission(session, ADMIN_PERMS.roleManage);

  const roles = await listRoles(session.orgId);
  const systemRoles = roles.filter((r) => r.isSystem);
  const orgRoles = roles.filter((r) => !r.isSystem);

  return (
    <AppScaffold
      title="บทบาท & สิทธิ์"
      width="max-w-3xl"
      fab={canManage ? <Fab href="/admin/roles/new" label="สร้างบทบาท" /> : null}
    >
      <p className="mb-4 text-sm text-(--ink-soft)">
        บทบาทของบริษัทแก้สิทธิ์ได้อิสระ ไม่กระทบบริษัทอื่น
      </p>

      <h2 className="mb-2 text-sm font-bold text-(--ink)">
        บทบาทของบริษัท ({orgRoles.length})
      </h2>
      <div className="mb-6 flex flex-col gap-2">
        {orgRoles.map((r) => (
          <Link key={r.id} href={`/admin/roles/${r.id}`}>
            <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-(--bg-soft)">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--ink)">
                  {r.name}{" "}
                  <span className="font-normal text-(--ink-soft)">
                    ({r.code})
                  </span>
                </p>
                {r.description && (
                  <p className="truncate text-xs text-(--ink-soft)">
                    {r.description}
                  </p>
                )}
              </div>
              {r.departmentName && <Pill color="#8B5CF6">{r.departmentName}</Pill>}
              <Pill color="#3B82F6">
                <Users className="h-3 w-3" /> {r.userCount}
              </Pill>
              <Pill color="#0D9488">{r.permissionCount} สิทธิ์</Pill>
              <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
            </Card>
          </Link>
        ))}
      </div>

      {systemRoles.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-bold text-(--ink)">
            บทบาทระดับระบบ
          </h2>
          <div className="flex flex-col gap-2">
            {systemRoles.map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-(--ink)">
                    {r.name}{" "}
                    <span className="font-normal text-(--ink-soft)">
                      ({r.code})
                    </span>
                  </p>
                  <p className="truncate text-xs text-(--ink-soft)">
                    เข้าถึงได้ทุกอย่างโดยไม่ต้องกำหนดสิทธิ์รายข้อ
                  </p>
                </div>
                <Pill color="#3B82F6">
                  <Users className="h-3 w-3" /> {r.userCount}
                </Pill>
                <Pill color="#9E9E9E">
                  <Lock className="h-3 w-3" /> แก้ไม่ได้
                </Pill>
              </Card>
            ))}
          </div>
        </>
      )}
    </AppScaffold>
  );
}
