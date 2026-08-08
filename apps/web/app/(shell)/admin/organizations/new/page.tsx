import { redirect } from "next/navigation";
import { requireOrg, isSuperAdmin } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { Field, SectionCard, inputClass, selectClass } from "@/modules/admin/components/ui";
import { ENABLED_MODULES, ORG_ROLES } from "@smartboss/database/defaults";
import { createOrganizationAction } from "../../actions";

/**
 * เปิดบริษัทใหม่ — หน้าจอรับลูกค้ารายใหม่เข้าแพลตฟอร์ม
 *
 * ฟอร์มเดียวจบ เพราะบริษัทที่ไม่มีผู้ดูแลคือบริษัทที่ไม่มีใครเข้าไปตั้งค่าได้
 * จึงบังคับให้สร้างผู้ดูแลคนแรกไปพร้อมกัน
 */
export const dynamic = "force-dynamic";

const MODULE_LABELS: Record<string, string> = {
  report_task: "รายงานและงาน",
  hr: "ระบบบุคคล",
  maintenance: "แจ้งซ่อมบำรุง",
};

export default async function NewOrganizationPage() {
  const session = await requireOrg();
  if (!isSuperAdmin(session)) redirect("/admin");

  return (
    <AppScaffold
      title="เปิดบริษัทใหม่"
      width="max-w-2xl"
      backHref="/admin/organizations"
    >
      <form action={createOrganizationAction} className="flex flex-col gap-4">
        <SectionCard
          title="ข้อมูลบริษัท"
          description="รหัสบริษัทเปลี่ยนทีหลังไม่ได้ เพราะถูกใช้อ้างอิงข้ามระบบ"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ชื่อบริษัท">
              <input
                type="text"
                name="name"
                required
                maxLength={120}
                placeholder="บริษัท ตัวอย่าง จำกัด"
                className={inputClass}
              />
            </Field>
            <Field label="รหัสบริษัท" hint="a-z 0-9 และ - เท่านั้น">
              <input
                type="text"
                name="slug"
                required
                pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
                maxLength={40}
                placeholder="tuayang"
                className={inputClass}
              />
            </Field>
            <Field label="แพ็กเกจ">
              <select name="planCode" defaultValue="PRO" className={selectClass}>
                <option value="FREE">FREE</option>
                <option value="PRO">PRO</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title="ผู้ดูแลคนแรกของบริษัท"
          description="ได้บทบาท ADMIN ของบริษัทนี้ แล้วเพิ่มพนักงานคนอื่นเองต่อได้"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ชื่อ-นามสกุล">
              <input
                type="text"
                name="adminName"
                required
                maxLength={120}
                className={inputClass}
              />
            </Field>
            <Field label="อีเมล" hint="ใช้เป็นชื่อผู้ใช้">
              <input type="email" name="adminEmail" required className={inputClass} />
            </Field>
            <Field label="รหัสผ่านตั้งต้น" hint="อย่างน้อย 12 ตัวอักษร">
              <input
                type="text"
                name="adminPassword"
                required
                minLength={12}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="mt-3 text-xs text-(--ink-soft)">
            แสดงเป็นข้อความธรรมดาเพื่อให้คัดลอกส่งให้ลูกค้าได้ —
            บอกให้เขาเปลี่ยนรหัสผ่านทันทีหลัง login ครั้งแรก
          </p>
        </SectionCard>

        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold text-(--ink)">
            สิ่งที่ระบบสร้างให้อัตโนมัติ
          </p>
          <ul className="flex list-inside list-disc flex-col gap-1 text-xs text-(--ink-soft)">
            <li>บทบาท {ORG_ROLES.length} ตัว พร้อมสิทธิ์ตั้งต้นของแต่ละบทบาท</li>
            <li>
              เปิดโมดูล{" "}
              {ENABLED_MODULES.map((c) => MODULE_LABELS[c] ?? c).join(" · ")}
            </li>
            <li>พื้นที่ข้อมูลของโมดูลบุคคล (tenant ฝั่ง workforce)</li>
            <li>บัญชีผู้ดูแลคนแรกตามที่กรอกไว้ด้านบน</li>
          </ul>
          <p className="mt-3 text-xs text-(--ink-soft)">
            ข้อมูลของบริษัทใหม่แยกขาดจากบริษัทอื่นทั้งหมด · บทบาทและสิทธิ์
            ปรับได้ทีหลังที่หน้าบทบาทของบริษัทนั้น
          </p>

          <Button type="submit" className="mt-4 w-full sm:w-40">
            เปิดบริษัท
          </Button>
        </Card>
      </form>
    </AppScaffold>
  );
}
