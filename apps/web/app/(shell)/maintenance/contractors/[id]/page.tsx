import { redirect, notFound } from "next/navigation";
import { Pencil, Star } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  getContractor,
  listContractorHistory,
  contractorOptions,
} from "@/modules/maintenance/data/contractors";
import {
  selectClass,
  Field,
  ComboInput,
} from "@/modules/maintenance/components/ui";
import { fmtThaiDate } from "@/modules/maintenance/lib/format";
import { formatBaht } from "@/modules/maintenance/lib/expense";
import { updateContractorAction, deleteContractorAction, addHistoryAction } from "../actions";
import { AppScaffold } from "@/modules/maintenance/components/app-scaffold";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-(--ink-soft)">{label}</span>
      <span className="text-right font-medium text-(--ink)">{value}</span>
    </div>
  );
}

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.contractorView)) redirect("/");
  const orgId = session.orgId;

  const contractor = await getContractor(orgId, id);
  if (!contractor) notFound();
  const canManage = hasPermission(session, MAINT_PERMS.contractorManage);
  const [history, options] = await Promise.all([
    listContractorHistory(orgId, id),
    // ตัวเลือกหมวด/โซนของบริษัทนี้ ดึงเฉพาะตอนที่แก้ไขได้จริง
    canManage
      ? contractorOptions(orgId)
      : Promise.resolve({ categories: [], zones: [] }),
  ]);

  return (
    <AppScaffold
      title="รายละเอียด Contact"
      width="max-w-2xl"
      backHref="/maintenance/contractors"
    >

      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-(--ink)">{contractor.name}</h1>
          {contractor.rating && (
            <span className="mt-1 inline-flex items-center gap-0.5 text-[#EAB308]">
              {Array.from({ length: Math.min(5, contractor.rating) }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-current" />
              ))}
            </span>
          )}
        </div>
        {canManage && (
          <form action={deleteContractorAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="ghost" size="sm">ลบ</Button>
          </form>
        )}
      </header>

      <Card className="mb-4 p-5">
        <InfoRow label="คุณสมบัติ" value={contractor.specialty || "-"} />
        <InfoRow label="บริษัท" value={contractor.companyName || "-"} />
        <InfoRow label="เบอร์โทร" value={contractor.phone || "-"} />
        <InfoRow label="ช่องทางติดต่ออื่นๆ" value={contractor.email || "-"} />
        <InfoRow label="พื้นที่ (Zone)" value={contractor.zone || "-"} />
        <InfoRow label="หมวดหมู่" value={contractor.category || "-"} />
        <InfoRow label="ราคา/ค่าบริการ" value={contractor.price != null ? formatBaht(Number(contractor.price)) : "-"} />
        {contractor.notes && <InfoRow label="หมายเหตุ" value={contractor.notes} />}
      </Card>

      {canManage && (
        <details className="mb-6">
          <summary className="mb-2 inline-flex cursor-pointer items-center gap-1 text-sm text-(--brand-green)">
            <Pencil className="h-4 w-4" /> แก้ไข
          </summary>
          <Card className="p-4">
            <form action={updateContractorAction.bind(null, id)} className="flex flex-col gap-3">
              <Input name="name" defaultValue={contractor.name} required />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input name="phone" defaultValue={contractor.phone ?? ""} placeholder="เบอร์โทร" />
                <Input name="email" defaultValue={contractor.email ?? ""} placeholder="ช่องทางติดต่ออื่นๆ" />
                <Input name="specialty" defaultValue={contractor.specialty ?? ""} placeholder="คุณสมบัติ" />
                <Input name="companyName" defaultValue={contractor.companyName ?? ""} placeholder="บริษัท" />
                <ComboInput
                  name="zone"
                  listId="edit-contact-zones"
                  options={options.zones}
                  defaultValue={contractor.zone ?? ""}
                  placeholder="โซน / พื้นที่ (พิมพ์ใหม่ได้)"
                />
                <ComboInput
                  name="category"
                  listId="edit-contact-categories"
                  options={options.categories}
                  defaultValue={contractor.category ?? ""}
                  placeholder="หมวดหมู่ (พิมพ์ใหม่ได้)"
                />
                <Input name="price" inputMode="decimal" defaultValue={contractor.price != null ? String(contractor.price) : ""} placeholder="ราคา/ค่าบริการ" />
              </div>
              <Field label="เรตติ้ง">
                <select name="rating" defaultValue={contractor.rating ? String(contractor.rating) : ""} className={selectClass}>
                  <option value="">— ไม่ระบุ —</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} ดาว</option>
                  ))}
                </select>
              </Field>
              <Input name="notes" defaultValue={contractor.notes ?? ""} placeholder="หมายเหตุ" />
              <Button type="submit" className="sm:w-40">บันทึก</Button>
            </form>
          </Card>
        </details>
      )}

      {/* History */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--ink)">ประวัติงาน ({history.length})</h2>
      </div>
      {canManage && (
        <details className="mb-3">
          <summary className="mb-2 inline-flex cursor-pointer items-center gap-1 text-sm text-(--brand-green)">
            + บันทึกประวัติงาน
          </summary>
          <Card className="p-4">
            <form action={addHistoryAction.bind(null, id)} className="flex flex-col gap-3">
              <Input name="description" placeholder="รายละเอียดงาน *" required />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input name="amount" inputMode="decimal" placeholder="ค่าใช้จ่าย (บาท)" />
                <Input name="workDate" type="date" />
                <select name="rating" defaultValue="" className={selectClass}>
                  <option value="">เรตติ้ง</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} ดาว</option>
                  ))}
                </select>
              </div>
              <Input name="notes" placeholder="หมายเหตุ" />
              <Button type="submit" className="sm:w-40">บันทึก</Button>
            </form>
          </Card>
        </details>
      )}
      {history.length === 0 ? (
        <Card className="p-6 text-center text-sm text-(--ink-soft)">ยังไม่มีประวัติงาน</Card>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <Card key={h.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-(--ink)">{h.description || "-"}</p>
                <p className="text-xs text-(--ink-soft)">
                  {h.workDate ? fmtThaiDate(h.workDate) : "-"}
                  {h.rating ? ` · ${h.rating}★` : ""}
                </p>
              </div>
              {h.amount != null && (
                <span className="text-sm font-semibold text-(--ink)">{formatBaht(Number(h.amount))}</span>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
