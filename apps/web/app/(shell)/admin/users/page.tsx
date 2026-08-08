import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight, Plus, ShieldCheck, UserX } from "lucide-react";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Avatar } from "@smartboss/ui/components/avatar";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold, Fab } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { listOrgUsers, listUsersAcrossOrgs } from "@/modules/admin/data/users";
import { listAllOrganizations } from "@/modules/admin/data/orgs";
import { EmptyState, Pill, selectClass } from "@/modules/admin/components/ui";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.userView)) redirect("/admin");
  const canManage = hasPermission(session, ADMIN_PERMS.userManage);

  const superAdmin = isSuperAdmin(session);
  const { orgId: filterOrgId } = await searchParams;

  /*
   * SUPER_ADMIN เห็นผู้ใช้ทุกบริษัท (กรองเฉพาะบริษัทเดียวได้)
   * แอดมินบริษัทเห็นเฉพาะคนในบริษัทตัวเองเท่านั้น — คนละ query กันชัดเจน
   */
  const organizations = superAdmin ? await listAllOrganizations() : [];
  const activeFilter =
    superAdmin && filterOrgId && organizations.some((o) => o.id === filterOrgId)
      ? filterOrgId
      : undefined;

  const users = superAdmin
    ? await listUsersAcrossOrgs(activeFilter)
    : (await listOrgUsers(session.orgId)).map((u) => ({ ...u, orgName: null }));

  const now = new Date();

  return (
    <AppScaffold
      title="ผู้ใช้งาน"
      width="max-w-4xl"
      fab={canManage ? <Fab href="/admin/users/new" label="เพิ่มผู้ใช้" /> : null}
    >
      {superAdmin && (
        <Card className="mb-3 p-4">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-(--ink-soft)">
                กรองตามบริษัท
              </span>
              <select
                name="orgId"
                defaultValue={activeFilter ?? ""}
                className={selectClass}
              >
                <option value="">ทุกบริษัท ({organizations.length} แห่ง)</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.isActive ? "" : " (ปิดใช้งาน)"} — {o.userCount} คน
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" className="w-full sm:w-28">
              กรอง
            </Button>
          </form>
        </Card>
      )}

      <p className="mb-3 text-sm text-(--ink-soft)">
        {users.length} คน · ใช้งานอยู่ {users.filter((u) => u.isActive).length} คน
      </p>

      {users.length === 0 ? (
        <EmptyState>ยังไม่มีผู้ใช้งาน</EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => {
            const locked = u.lockedUntil != null && u.lockedUntil > now;
            return (
              <Link key={u.id} href={`/admin/users/${u.id}`}>
                <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-(--bg-soft)">
                  <Avatar name={u.name} src={u.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-(--ink)">
                      {u.name}
                      {u.id === session.userId && (
                        <span className="text-[11px] font-normal text-(--ink-soft)">
                          (คุณ)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-(--ink-soft)">{u.email}</p>
                    {/* โชว์บริษัทเฉพาะตอนดูข้ามบริษัท ไม่งั้นซ้ำซ้อนเพราะมีบริษัทเดียว */}
                    {superAdmin && !activeFilter && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-(--ink-soft)">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {u.orgName ?? "ระดับแพลตฟอร์ม (ไม่สังกัดบริษัท)"}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {u.hasSystemRole && (
                      <Pill color="#8B5CF6">
                        <ShieldCheck className="h-3 w-3" /> ผู้ดูแลระบบ
                      </Pill>
                    )}
                    {u.roleNames.slice(0, 2).map((r) => (
                      <Pill key={r} color="#3B82F6">
                        {r}
                      </Pill>
                    ))}
                    {u.roleNames.length === 0 && (
                      <Pill color="#9E9E9E">ยังไม่มีบทบาท</Pill>
                    )}
                    {!u.isActive && (
                      <Pill color="#DC2626">
                        <UserX className="h-3 w-3" /> ปิดใช้งาน
                      </Pill>
                    )}
                    {locked && <Pill color="#EA580C">ถูกล็อกชั่วคราว</Pill>}
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {canManage && (
        <Link
          href="/admin/users/new"
          className="mt-4 inline-flex items-center gap-1 text-sm text-(--brand-green) lg:hidden"
        >
          <Plus className="h-4 w-4" /> เพิ่มผู้ใช้
        </Link>
      )}
    </AppScaffold>
  );
}
