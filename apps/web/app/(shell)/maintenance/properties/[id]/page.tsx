import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  Pencil,
  Plus,
  Package,
  ClipboardList,
  CalendarClock,
  ChevronRight,
} from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { getProperty } from "@/modules/maintenance/data/properties";
import { listAssets, lastMaintenanceDates } from "@/modules/maintenance/data/assets";
import { userNameMap } from "@/modules/maintenance/data/users";
import { createAssetAction } from "../../assets/actions";
import { deletePropertyAction } from "../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-(--ink-soft)">{label}</span>
      <span className="text-right font-medium text-(--ink)">{value}</span>
    </div>
  );
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.propertyView)) redirect("/");
  const orgId = session.orgId;

  const property = await getProperty(orgId, id);
  if (!property) notFound();

  const canManageProp = hasPermission(session, MAINT_PERMS.propertyManage);
  const canManageAsset = hasPermission(session, MAINT_PERMS.assetManage);

  const assets = await listAssets(orgId, id);
  const [caretakerNames, lastMaint] = await Promise.all([
    userNameMap(orgId, [property.caretakerId]),
    lastMaintenanceDates(orgId, assets.map((a) => a.id)),
  ]);

  return (
    <AppScaffold
      title={property.name}
      width="max-w-3xl"
      backHref="/maintenance/properties"
    >
      <header className="mb-4 flex items-start justify-end gap-3">
        {canManageProp && (
          <div className="flex shrink-0 gap-2">
            <Link href={`/maintenance/properties/${id}/edit`}>
              <Button variant="outline" size="sm" className="gap-1">
                <Pencil className="h-4 w-4" /> แก้ไข
              </Button>
            </Link>
            <form action={deletePropertyAction}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="ghost" size="sm">
                ลบ
              </Button>
            </form>
          </div>
        )}
      </header>

      {/* ข้อมูลบ้าน */}
      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-semibold text-(--ink)">ข้อมูลบ้าน</h2>
        <InfoRow
          label="ผู้จัดการบ้าน"
          value={property.caretakerId ? caretakerNames[property.caretakerId] ?? "-" : "ไม่มี"}
        />
        <InfoRow label="ที่อยู่" value={property.address || "-"} />
        <InfoRow label="เจ้าของ" value={property.ownerName || "-"} />
        <InfoRow label="ติดต่อเจ้าของ" value={property.ownerContact || "-"} />
        {property.notes && <InfoRow label="หมายเหตุ" value={property.notes} />}
      </Card>

      {/* ลิงก์ไปงานที่เกี่ยวข้อง */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link href={`/maintenance/work-orders?propertyId=${id}`}>
          <Card className="flex items-center gap-2 p-3 text-sm hover:bg-(--bg-soft)">
            <ClipboardList className="h-4 w-4" style={{ color: "#0D9488" }} />
            ใบแจ้งซ่อมของบ้านนี้
          </Card>
        </Link>
        <Link href={`/maintenance/pm?propertyId=${id}`}>
          <Card className="flex items-center gap-2 p-3 text-sm hover:bg-(--bg-soft)">
            <CalendarClock className="h-4 w-4" style={{ color: "#0D9488" }} />
            แผน PM ของบ้านนี้
          </Card>
        </Link>
      </div>

      {/* อุปกรณ์ */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-(--ink)">
          อุปกรณ์ ({assets.length})
        </h2>
      </div>

      {canManageAsset && <AddAssetForm propertyId={id} />}

      {assets.length === 0 ? (
        <Card className="p-8 text-center text-sm text-(--ink-soft)">
          <Package className="mx-auto mb-2 h-12 w-12 opacity-40" />
          ยังไม่มีอุปกรณ์
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {assets.map((a) => {
            const last = lastMaint[a.id];
            return (
              <Link key={a.id} href={`/maintenance/assets/${a.id}`}>
                <Card className="flex items-center gap-3 p-3 hover:bg-(--bg-soft)">
                  {a.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={a.imageUrl}
                      alt={a.name}
                      className="h-12 w-12 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ECFDF7]">
                      <Package className="h-5 w-5" style={{ color: "#0D9488" }} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-(--ink)">
                      {a.name}
                    </p>
                    {a.notes && (
                      <p className="truncate text-xs text-(--ink-soft)">
                        {a.notes}
                      </p>
                    )}
                    <p className="truncate text-xs text-(--ink-soft)">
                      🔧{" "}
                      {last ? `ล่าสุด: ${fmtDate(last)}` : "ยังไม่เคย maintenance"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}

function AddAssetForm({ propertyId }: { propertyId: string }) {
  const action = createAssetAction.bind(null, propertyId);
  return (
    <details className="mb-3">
      <summary className="mb-2 inline-flex cursor-pointer items-center gap-1 rounded-(--radius) bg-[#CCFBF1] px-3 py-1.5 text-sm font-medium text-[#0F766E]">
        <Plus className="h-4 w-4" /> อุปกรณ์ที่จะ PM
      </summary>
      <Card className="p-4">
        <form action={action} className="flex flex-col gap-3">
          <Input name="name" placeholder="ชื่ออุปกรณ์ *" required />
          <textarea
            name="notes"
            rows={2}
            placeholder="หมายเหตุ"
            className="w-full rounded-(--radius) border border-(--line) bg-(--bg) px-3 py-2 text-sm text-(--ink)"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input name="category" placeholder="หมวด (เช่น แอร์)" />
            <Input name="brand" placeholder="ยี่ห้อ" />
            <Input name="model" placeholder="รุ่น" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-(--ink-soft)">
              วันติดตั้ง
              <Input name="installDate" type="date" className="mt-1" />
            </label>
            <label className="text-xs text-(--ink-soft)">
              ประกันหมดอายุ
              <Input name="warrantyExpiry" type="date" className="mt-1" />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-(--ink-soft)">รูปอุปกรณ์</span>
            <input
              type="file"
              name="image"
              accept="image/*"
              className="text-sm text-(--ink) file:mr-3 file:rounded-(--radius) file:border file:border-(--line) file:bg-(--bg-soft) file:px-3 file:py-1.5 file:text-sm"
            />
          </label>
          <Button type="submit" className="sm:w-40">
            เพิ่มอุปกรณ์
          </Button>
        </form>
      </Card>
    </details>
  );
}
