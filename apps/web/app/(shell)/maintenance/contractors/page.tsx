import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import { listContractors } from "@/modules/maintenance/data/contractors";
import {
  selectClass,
  Field,
  ComboInput,
} from "@/modules/maintenance/components/ui";
import { facetsOf, UNSET } from "@/modules/maintenance/lib/contacts";
import {
  ContactList,
  type ContactRow,
} from "@/modules/maintenance/components/contact-list";
import { createContractorAction } from "./actions";
import { AppScaffold, Fab } from "@/modules/maintenance/components/app-scaffold";

export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const session = await requireOrg();
  if (!hasPermission(session, MAINT_PERMS.contractorView)) redirect("/");
  const canManage = hasPermission(session, MAINT_PERMS.contractorManage);
  const { add } = await searchParams;

  const all = await listContractors(session.orgId);

  // Decimal ของ Prisma ส่งข้าม server→client ไม่ได้ ต้องแปลงเป็น number ที่นี่
  const rows: ContactRow[] = all.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    specialty: c.specialty,
    companyName: c.companyName,
    zone: c.zone,
    category: c.category,
    rating: c.rating,
    price: c.price != null ? Number(c.price) : null,
    isActive: c.isActive,
  }));

  // ตัวเลือกในฟอร์ม = ค่าที่บริษัทนี้ใช้อยู่จริง ไม่ใช่รายการตายตัวในโค้ด
  const catOptions = facetsOf(rows, (c) => c.category)
    .filter((f) => f.value !== UNSET)
    .map((f) => f.value);
  const zoneOptions = facetsOf(rows, (c) => c.zone)
    .filter((f) => f.value !== UNSET)
    .map((f) => f.value);

  return (
    <AppScaffold
      title="รายชื่อ Contact"
      width="max-w-5xl"
      fab={
        canManage ? (
          <Fab href="/maintenance/contractors?add=1" label="เพิ่ม Contact" />
        ) : null
      }
    >
      {canManage && (
        <details className="mb-4" open={add === "1"}>
          <summary className="mb-2 inline-flex cursor-pointer items-center gap-1 text-sm font-medium text-(--brand-green)">
            <Plus className="h-4 w-4" /> เพิ่ม Contact
          </summary>
          <Card className="p-4 sm:p-5">
            <form action={createContractorAction} className="flex flex-col gap-3">
              <Field label="ชื่อ *">
                <Input name="name" placeholder="ชื่อผู้ติดต่อ" required />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="เบอร์โทร">
                  <Input name="phone" inputMode="tel" placeholder="08x-xxx-xxxx" />
                </Field>
                <Field label="ช่องทางอื่น" hint="(LINE ID, Facebook)">
                  <Input name="email" placeholder="เช่น LINE: @changyai" />
                </Field>
                <Field label="หมวดหมู่ *" hint="พิมพ์ใหม่ได้">
                  <ComboInput
                    name="category"
                    listId="contact-categories"
                    options={catOptions}
                    placeholder="เช่น งานช่าง"
                    required
                  />
                </Field>
                <Field label="โซน / พื้นที่" hint="พิมพ์ใหม่ได้">
                  <ComboInput
                    name="zone"
                    listId="contact-zones"
                    options={zoneOptions}
                    placeholder="เช่น บางแสน"
                  />
                </Field>
                <Field label="คุณสมบัติ">
                  <Input
                    name="specialty"
                    placeholder="เช่น ไฟฟ้า, ประปา, แอร์"
                  />
                </Field>
                <Field label="บริษัท">
                  <Input name="companyName" placeholder="ชื่อบริษัท/ร้าน" />
                </Field>
                <Field label="ราคา/ค่าบริการ *">
                  <Input
                    name="price"
                    inputMode="decimal"
                    placeholder="ระบุเป็นตัวเลข"
                    required
                  />
                </Field>
                <Field label="เรตติ้ง">
                  <select name="rating" defaultValue="" className={selectClass}>
                    <option value="">— ไม่ระบุ —</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} ดาว
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="หมายเหตุ">
                <Input name="notes" placeholder="หมายเหตุเพิ่มเติม" />
              </Field>
              <div>
                <Button type="submit" className="sm:w-40">
                  บันทึก
                </Button>
              </div>
            </form>
          </Card>
        </details>
      )}

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ยังไม่มี Contact {canManage ? "— เพิ่ม Contact แรกได้เลย" : ""}
        </Card>
      ) : (
        <ContactList contacts={rows} />
      )}
    </AppScaffold>
  );
}
