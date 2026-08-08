import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { Field, inputClass } from "@/modules/admin/components/ui";
import { createRoleAction } from "../../actions";

export default async function NewRolePage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.roleManage)) redirect("/admin/roles");

  return (
    <AppScaffold title="สร้างบทบาท" width="max-w-2xl" backHref="/admin/roles">
      <Card className="p-5">
        <form action={createRoleAction} className="flex flex-col gap-4">
          <Field label="ชื่อบทบาท *" hint="เช่น หัวหน้าช่าง">
            <input name="name" required maxLength={80} className={inputClass} />
          </Field>

          <Field
            label="รหัสบทบาท *"
            hint="ตัวพิมพ์ใหญ่ ตัวเลข และ _ เท่านั้น เช่น LEAD_TECH"
          >
            <input
              name="code"
              required
              pattern="[A-Za-z0-9_]{2,40}"
              placeholder="LEAD_TECH"
              className={`${inputClass} font-mono uppercase`}
            />
          </Field>

          <Field label="คำอธิบาย">
            <input name="description" maxLength={200} className={inputClass} />
          </Field>

          <p className="text-xs text-(--ink-soft)">
            สร้างเสร็จแล้วจะพาไปหน้ากำหนดสิทธิ์ของบทบาทนี้ต่อ
          </p>

          <div>
            <Button type="submit" className="w-full sm:w-40">
              สร้างบทบาท
            </Button>
          </div>
        </form>
      </Card>
    </AppScaffold>
  );
}
