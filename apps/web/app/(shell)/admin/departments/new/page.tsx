import { redirect } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { AppScaffold } from "@/components/module/app-scaffold";
import { ADMIN_PERMS } from "@/modules/admin/permissions";
import { Field, inputClass } from "@/modules/admin/components/ui";
import { createDepartmentAction } from "../../actions";

export default async function NewDepartmentPage() {
  const session = await requireOrg();
  if (!hasPermission(session, ADMIN_PERMS.departmentManage)) redirect("/admin/departments");

  return (
    <AppScaffold title="สร้างแผนก" width="max-w-2xl" backHref="/admin/departments">
      <Card className="p-5">
        <form action={createDepartmentAction} className="flex flex-col gap-4">
          <Field label="ชื่อแผนก *" hint="เช่น ฝ่ายขาย">
            <input name="name" required maxLength={80} className={inputClass} />
          </Field>

          <Field label="คำอธิบาย">
            <input name="description" maxLength={200} className={inputClass} />
          </Field>

          <p className="text-xs text-(--ink-soft)">
            สร้างเสร็จแล้วจะพาไปหน้ากำหนดสิทธิ์ของแผนกนี้ต่อ
          </p>

          <div>
            <Button type="submit" className="w-full sm:w-40">
              สร้างแผนก
            </Button>
          </div>
        </form>
      </Card>
    </AppScaffold>
  );
}
