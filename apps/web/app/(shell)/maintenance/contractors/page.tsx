import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, HardHat, Star, MapPin } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listContractors } from "@/modules/maintenance/data/contractors";
import {
  selectClass,
  Field,
  ChipLink,
} from "@/modules/maintenance/components/ui";
import {
  CONTACT_CATEGORIES,
  CONTACT_ZONES,
} from "@/modules/maintenance/lib/contacts";
import { createContractorAction } from "./actions";
import { AppScaffold, Fab } from "@/modules/maintenance/components/app-scaffold";

function Stars({ n }: { n: number | null }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[#EAB308]">
      {Array.from({ length: Math.min(5, n) }).map((_, i) => (
        <Star key={i} className="h-3 w-3 fill-current" />
      ))}
    </span>
  );
}

export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; add?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.contractorView)) redirect("/");
  const canManage = hasPermission(session, MAINT_PERMS.contractorManage);
  const { cat, add } = await searchParams;

  const all = await listContractors(session.orgId);
  const contractors = cat ? all.filter((c) => c.category === cat) : all;
  const catQ = cat ? `&cat=${encodeURIComponent(cat)}` : "";

  return (
    <AppScaffold
      title="รายชื่อ Contact"
      width="max-w-3xl"
      fab={
        canManage ? (
          <Fab href={`/maintenance/contractors?add=1${catQ}`} label="เพิ่ม Contact" />
        ) : null
      }
    >
      {/* ตัวกรองหมวดหมู่ */}
      {all.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <ChipLink href="/maintenance/contractors" active={!cat}>
            ทั้งหมด
          </ChipLink>
          {CONTACT_CATEGORIES.map((c) => (
            <ChipLink
              key={c}
              href={`/maintenance/contractors?cat=${encodeURIComponent(c)}`}
              active={cat === c}
            >
              {c}
            </ChipLink>
          ))}
        </div>
      )}

      {canManage && (
        <details className="mb-4" open={add === "1"}>
          <summary className="mb-2 inline-flex cursor-pointer items-center gap-1 text-sm text-(--brand-green)">
            <Plus className="h-4 w-4" /> เพิ่ม Contact
          </summary>
          <Card className="p-4">
            <form action={createContractorAction} className="flex flex-col gap-3">
              <Input name="name" placeholder="ชื่อ *" required />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input name="phone" placeholder="เบอร์โทร" />
                <Input name="email" placeholder="ช่องทางติดต่ออื่นๆ (LINE ID, Facebook)" />
              </div>
              <Input
                name="specialty"
                placeholder="คุณสมบัติ (เช่น ไฟฟ้า, ประปา, แอร์, กฎหมาย)"
              />
              <Input
                name="price"
                inputMode="decimal"
                placeholder="ราคา/ค่าบริการ * (ระบุราคาเป็นตัวเลข)"
                required
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="หมวดหมู่ *">
                  <select name="category" defaultValue="" required className={selectClass}>
                    <option value="">เลือกหมวดหมู่</option>
                    {CONTACT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="พื้นที่ (Zone)">
                  <select name="zone" defaultValue="" className={selectClass}>
                    <option value="">ไม่ระบุ</option>
                    {CONTACT_ZONES.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Input name="companyName" placeholder="บริษัท" />
              <Field label="เรตติ้ง (1-5)">
                <select name="rating" defaultValue="" className={selectClass}>
                  <option value="">— ไม่ระบุ —</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} ดาว
                    </option>
                  ))}
                </select>
              </Field>
              <Input name="notes" placeholder="หมายเหตุ" />
              <Button type="submit" className="sm:w-40">
                บันทึก
              </Button>
            </form>
          </Card>
        </details>
      )}

      {contractors.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มี Contact {canManage ? "— เพิ่ม Contact แรกได้เลย" : ""}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {contractors.map((c) => (
            <Link key={c.id} href={`/maintenance/contractors/${c.id}`}>
              <Card className="flex items-center gap-3 p-4 hover:bg-(--bg-soft)">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#CCFBF1]">
                  <HardHat className="h-5 w-5" style={{ color: "#0F766E" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-(--ink)">
                    {c.name}
                    {!c.isActive && (
                      <span className="ml-2 text-xs font-normal text-(--ink-soft)">
                        (ปิดใช้งาน)
                      </span>
                    )}
                  </p>
                  {c.specialty && (
                    <p className="truncate text-xs text-(--ink-soft)">
                      {c.specialty}
                    </p>
                  )}
                  {c.zone && (
                    <p className="inline-flex items-center gap-0.5 text-xs text-(--ink-soft)">
                      <MapPin className="h-3 w-3" /> {c.zone}
                    </p>
                  )}
                </div>
                <Stars n={c.rating} />
                {c.phone && (
                  <span className="shrink-0 text-xs text-(--ink-soft)">
                    {c.phone}
                  </span>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppScaffold>
  );
}
