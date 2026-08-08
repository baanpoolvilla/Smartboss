import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { adminManifest } from "@/modules/admin/manifest";
import { countOrgUsers } from "@/modules/admin/data/users";
import { listRoles } from "@/modules/admin/data/roles";
import { getOrganization, listOrgModules } from "@/modules/admin/data/org";
import { StatCard } from "@/modules/admin/components/ui";
import { iconByName } from "@/lib/icons";
import { moduleRegistry } from "@/module-registry";

export default async function AdminHomePage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.access)) redirect("/");

  const [users, roles, modules, org] = await Promise.all([
    countOrgUsers(session.orgId),
    listRoles(session.orgId),
    listOrgModules(session.orgId),
    getOrganization(session.orgId),
  ]);

  const enabledModules = modules.filter((m) => m.enabled);

  // เมนูหลังบ้านที่ผู้ใช้คนนี้เข้าได้ (ยกเว้น "ภาพรวม" ที่เป็นหน้านี้เอง)
  const sections = adminManifest.menus
    .filter((m) => m.path !== "/admin" && hasPermission(session, m.permission))
    .map((m) => ({ ...m, Icon: iconByName(m.icon) }));

  // ตั้งค่าของแต่ละโมดูลที่เปิดใช้ — โมดูลไหนมีหน้าตั้งค่าของตัวเองก็ลิงก์ไป
  const moduleSettings = enabledModules
    .map((m) => {
      const manifest = moduleRegistry.find((r) => r.id === m.code);
      if (!manifest) return null;
      const settingMenu = manifest.menus.find(
        (menu) =>
          menu.path.includes("/settings") && hasPermission(session, menu.permission)
      );
      if (!settingMenu) return null;
      return {
        code: m.code,
        name: manifest.name,
        color: manifest.color,
        colorBg: manifest.colorBg,
        icon: manifest.icon,
        path: settingMenu.path,
        label: settingMenu.label,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return (
    <AppScaffold title="หลังบ้าน" width="max-w-5xl">
      <p className="mb-4 text-sm text-(--ink-soft)">
        จัดการผู้ใช้ สิทธิ์ และการตั้งค่าของทุกโมดูลใน{" "}
        <span className="font-medium text-(--ink)">{org?.name}</span>
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="ผู้ใช้งานทั้งหมด"
          value={users.total}
          hint={`ใช้งานอยู่ ${users.active} คน`}
          href="/admin/users"
          color="#3B82F6"
        />
        <StatCard
          label="บทบาท"
          value={roles.length}
          hint={`ของบริษัท ${roles.filter((r) => !r.isSystem).length}`}
          href="/admin/roles"
          color="#8B5CF6"
        />
        <StatCard
          label="โมดูลที่เปิดใช้"
          value={enabledModules.length}
          hint={`จากทั้งหมด ${modules.length}`}
          href="/admin/modules"
          color="#0D9488"
        />
        <StatCard
          label="แพ็กเกจ"
          value={org?.planCode ?? "-"}
          hint={org?.slug}
          href="/admin/organization"
          color="#F97316"
        />
      </div>

      {/* ─── ทางลัดไปแต่ละส่วนของหลังบ้าน ─── */}
      <h2 className="mb-2 mt-6 text-base font-bold text-(--ink)">
        จัดการระบบ
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.path} href={s.path}>
            <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-(--bg-soft)">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EEF1F6]">
                <s.Icon className="h-4 w-4 text-(--ink)" />
              </span>
              <span className="flex-1 text-sm font-medium text-(--ink)">
                {s.label}
              </span>
              <ChevronRight className="h-4 w-4 text-(--ink-soft)" />
            </Card>
          </Link>
        ))}
      </div>

      {/* ─── ตั้งค่าเฉพาะของแต่ละโมดูล ─── */}
      {moduleSettings.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-base font-bold text-(--ink)">
            ตั้งค่าของแต่ละโมดูล
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {moduleSettings.map((m) => {
              const Icon = iconByName(m.icon);
              return (
                <Link key={m.code} href={m.path}>
                  <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-(--bg-soft)">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                      style={{ backgroundColor: m.colorBg }}
                    >
                      <Icon className="h-4 w-4" style={{ color: m.color }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-(--ink)">
                        {m.name}
                      </span>
                      <span className="block truncate text-xs text-(--ink-soft)">
                        {m.label}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-(--ink-soft)" />
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </AppScaffold>
  );
}
