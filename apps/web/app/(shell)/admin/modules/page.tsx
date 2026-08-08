import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { listOrgModules } from "@/modules/admin/data/org";
import { Pill } from "@/modules/admin/components/ui";
import { iconByName } from "@/lib/icons";
import { moduleRegistry } from "@/module-registry";
import { toggleModuleAction } from "../actions";

export default async function AdminModulesPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.moduleManage)) redirect("/admin");

  const modules = await listOrgModules(session.orgId);

  return (
    <AppScaffold title="โมดูล" width="max-w-3xl">
      <p className="mb-4 text-sm text-(--ink-soft)">
        เปิด/ปิดโมดูลที่บริษัทใช้งาน — ปิดแล้วไอคอนจะหายจากหน้ารวมแอปของทุกคนในบริษัท
      </p>

      <div className="flex flex-col gap-2">
        {modules.map((m) => {
          const manifest = moduleRegistry.find((r) => r.id === m.code);
          const Icon = iconByName(manifest?.icon);
          return (
            <Card key={m.id} className="flex items-center gap-3 p-4">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
                style={{ backgroundColor: manifest?.colorBg ?? "#F1F5F9" }}
              >
                <Icon className="h-5 w-5" style={{ color: m.color }} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--ink)">
                  {m.name}
                </p>
                <p className="truncate text-xs text-(--ink-soft)">
                  {m.installed
                    ? m.enabled
                      ? "เปิดใช้งานอยู่"
                      : "ปิดอยู่"
                    : "ยังไม่พร้อมใช้งาน (อยู่ระหว่างพัฒนา)"}
                </p>
              </div>

              {!m.installed ? (
                <Pill color="#9E9E9E">เร็ว ๆ นี้</Pill>
              ) : (
                <>
                  {m.enabled ? (
                    <Pill color="#16A34A">เปิด</Pill>
                  ) : (
                    <Pill color="#9E9E9E">ปิด</Pill>
                  )}
                  <form action={toggleModuleAction}>
                    <input type="hidden" name="moduleId" value={m.id} />
                    <input
                      type="hidden"
                      name="enable"
                      value={m.enabled ? "0" : "1"}
                    />
                    <Button type="submit" size="sm" variant="outline">
                      {m.enabled ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    </Button>
                  </form>
                </>
              )}
            </Card>
          );
        })}
      </div>
    </AppScaffold>
  );
}
