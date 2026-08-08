import Link from "next/link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listAssets, lastMaintenanceDates } from "@/modules/maintenance/data/assets";
import { listProperties } from "@/modules/maintenance/data/properties";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "ยังไม่เคย";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}

export default async function AssetsListPage() {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.assetView)) redirect("/");
  const orgId = session.orgId;

  const [assets, properties] = await Promise.all([
    listAssets(orgId),
    listProperties(orgId),
  ]);
  const propNames = Object.fromEntries(properties.map((p) => [p.id, p.name]));
  const lastMaint = await lastMaintenanceDates(
    orgId,
    assets.map((a) => a.id)
  );

  return (
    <AppScaffold title="อุปกรณ์ทั้งหมด" backHref="/maintenance/properties">
      {assets.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มีอุปกรณ์ — เพิ่มได้ที่หน้ารายละเอียดบ้าน
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {assets.map((a) => (
            <Link key={a.id} href={`/maintenance/assets/${a.id}`}>
              <Card className="flex items-center gap-3 p-3 hover:bg-(--bg-soft)">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ECFDF7]">
                  <Package className="h-5 w-5" style={{ color: "#0D9488" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-(--ink)">
                    {a.name}
                  </p>
                  <p className="truncate text-xs text-(--ink-soft)">
                    {propNames[a.propertyId] ?? "-"} · 🔧 {fmtDate(lastMaint[a.id])}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
