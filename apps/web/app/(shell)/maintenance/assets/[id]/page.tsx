import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  Pencil,
  Plus,
  ShieldCheck,
  ShieldAlert,
  CalendarClock,
} from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { getAsset, lastMaintenanceDates } from "@/modules/maintenance/data/assets";
import { getProperty } from "@/modules/maintenance/data/properties";
import { listPmForAsset } from "@/modules/maintenance/data/pm";
import { freqLabel } from "@/modules/maintenance/lib/pm-schedule";
import { updateAssetAction, deleteAssetAction } from "../actions";
import { deletePmAction } from "../../pm/actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}
function dateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-(--ink-soft)">{label}</span>
      <span className="text-right font-medium text-(--ink)">{value}</span>
    </div>
  );
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.assetView)) redirect("/");
  const orgId = session.orgId;

  const asset = await getAsset(orgId, id);
  if (!asset) notFound();

  const canManage = hasPermission(session, MAINT_PERMS.assetManage);
  const canManagePm = hasPermission(session, MAINT_PERMS.pmManage);
  const [property, lastMap, schedules] = await Promise.all([
    getProperty(orgId, asset.propertyId),
    lastMaintenanceDates(orgId, [id]),
    listPmForAsset(orgId, id),
  ]);
  const warrantyExpired =
    asset.warrantyExpiry != null && asset.warrantyExpiry < new Date();

  return (
    <AppScaffold
      title={asset.name}
      width="max-w-2xl"
      backHref={
        property ? `/maintenance/properties/${property.id}` : "/maintenance/assets"
      }
    >
      <header className="mb-4 flex items-start justify-end gap-3">
        {canManage && (
          <form action={deleteAssetAction}>
            <input type="hidden" name="id" value={id} />
            <input
              type="hidden"
              name="back"
              value={property ? `/maintenance/properties/${property.id}` : "/maintenance/assets"}
            />
            <Button type="submit" variant="ghost" size="sm">
              ลบอุปกรณ์
            </Button>
          </form>
        )}
      </header>

      {asset.imageUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={asset.imageUrl}
          alt={asset.name}
          className="mb-4 h-[200px] w-full rounded-xl object-cover"
        />
      )}

      <Card className="mb-4 p-5">
        <h2 className="mb-2 text-sm font-semibold text-(--ink)">ข้อมูลอุปกรณ์</h2>
        <InfoRow label="บ้าน" value={property?.name ?? "-"} />
        <InfoRow label="หมวด" value={asset.category || "-"} />
        <InfoRow label="ยี่ห้อ" value={asset.brand || "-"} />
        <InfoRow label="รุ่น" value={asset.model || "-"} />
        <InfoRow label="วันติดตั้ง" value={fmtDate(asset.installDate)} />
        <div className="flex justify-between gap-4 py-1.5 text-sm">
          <span className="text-(--ink-soft)">ประกัน</span>
          <span
            className="inline-flex items-center gap-1 text-right font-medium"
            style={{ color: warrantyExpired ? "#DC2626" : "var(--ink)" }}
          >
            {asset.warrantyExpiry ? (
              <>
                {warrantyExpired ? (
                  <ShieldAlert className="h-4 w-4" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {fmtDate(asset.warrantyExpiry)}
                {warrantyExpired ? " (หมดแล้ว)" : ""}
              </>
            ) : (
              "-"
            )}
          </span>
        </div>
        {asset.notes && <InfoRow label="หมายเหตุ" value={asset.notes} />}
        <InfoRow label="ซ่อมบำรุงล่าสุด" value={fmtDate(lastMap[id])} />
      </Card>

      {canManage && (
        <details className="mb-6">
          <summary className="mb-2 inline-flex cursor-pointer items-center gap-1 text-sm text-(--brand-green)">
            <Pencil className="h-4 w-4" /> แก้ไขอุปกรณ์
          </summary>
          <Card className="p-4">
            <form
              action={updateAssetAction.bind(null, id)}
              className="flex flex-col gap-3"
            >
              <Input name="name" defaultValue={asset.name} required />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input name="category" defaultValue={asset.category ?? ""} placeholder="หมวด" />
                <Input name="brand" defaultValue={asset.brand ?? ""} placeholder="ยี่ห้อ" />
                <Input name="model" defaultValue={asset.model ?? ""} placeholder="รุ่น" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs text-(--ink-soft)">
                  วันติดตั้ง
                  <Input name="installDate" type="date" defaultValue={dateInput(asset.installDate)} className="mt-1" />
                </label>
                <label className="text-xs text-(--ink-soft)">
                  ประกันหมดอายุ
                  <Input name="warrantyExpiry" type="date" defaultValue={dateInput(asset.warrantyExpiry)} className="mt-1" />
                </label>
              </div>
              <Input name="notes" defaultValue={asset.notes ?? ""} placeholder="หมายเหตุ" />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-(--ink-soft)">
                  เปลี่ยนรูปอุปกรณ์ (ไม่เลือก = ใช้รูปเดิม)
                </span>
                <input
                  type="file"
                  name="image"
                  accept="image/*"
                  className="text-sm text-(--ink) file:mr-3 file:rounded-(--radius) file:border file:border-(--line) file:bg-(--bg-soft) file:px-3 file:py-1.5 file:text-sm"
                />
              </label>
              <Button type="submit" className="sm:w-40">บันทึก</Button>
            </form>
          </Card>
        </details>
      )}

      {/* แผน PM ของอุปกรณ์นี้ */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-(--ink)">
          แผน PM ({schedules.length})
        </h2>
        {canManagePm && (
          <Link
            href={`/maintenance/pm/new?assetId=${id}&propertyId=${asset.propertyId}`}
          >
            <Button
              type="button"
              size="sm"
              className="gap-1 bg-[#CCFBF1] text-[#0F766E] hover:brightness-95"
            >
              <Plus className="h-4 w-4" /> เพิ่ม PM
            </Button>
          </Link>
        )}
      </div>
      {schedules.length === 0 ? (
        <Card className="p-8 text-center text-sm text-(--ink-soft)">
          <CalendarClock className="mx-auto mb-2 h-12 w-12 opacity-40" />
          ยังไม่มีแผน PM
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {schedules.map((s) => {
            const left = Math.round(
              (new Date(s.nextDueDate).setHours(0, 0, 0, 0) -
                new Date().setHours(0, 0, 0, 0)) /
                86_400_000
            );
            const overdue = left < 0;
            const dueSoon = left >= 0 && left <= 7;
            const color = overdue ? "#DC2626" : dueSoon ? "#EA580C" : "#0D9488";
            const statusText = overdue
              ? `เกินกำหนด ${-left} วัน`
              : `${left} วัน`;
            return (
              <Card key={s.id} className="p-3">
                <div className="flex items-start gap-3">
                  <CalendarClock
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-(--ink)">
                      {s.title}
                    </p>
                    <p className="truncate text-xs text-(--ink-soft)">
                      ทุก {freqLabel(s.frequency)} • ครบกำหนด{" "}
                      {fmtDate(s.nextDueDate)}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold"
                    style={{ color, backgroundColor: `${color}1a` }}
                  >
                    {statusText}
                  </span>
                </div>
                {canManagePm && (
                  <div className="mt-2 flex items-center gap-2">
                    <Link
                      href={`/maintenance/work-orders/new?pmScheduleId=${s.id}&assetId=${id}&propertyId=${s.propertyId}&title=${encodeURIComponent(s.title)}`}
                    >
                      <Button type="button" size="sm" variant="outline" className="gap-1">
                        <Plus className="h-3.5 w-3.5" /> สร้างใบงาน
                      </Button>
                    </Link>
                    <form action={deletePmAction} className="ml-auto">
                      <input type="hidden" name="id" value={s.id} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        className="text-[#DC2626]"
                      >
                        ลบ
                      </Button>
                    </form>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}
