import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, type Company, type Paged } from "@/modules/hr/lib/api";
import { ApiProblem, Field, inputClass, selectClass } from "@/modules/hr/components/ui";
import { createEmployeeAction } from "../../actions";

export default async function NewEmployeePage() {
  return (
    <HrPage
      title="เพิ่มพนักงาน"
      permission={HR_PERMS.employeeManage}
      backHref="/hr/employees"
      width="max-w-2xl"
      load={async () => {
        const companies = await wfFetch<Paged<Company>>("/companies");
        const company = companies.items[0];

        if (!company) {
          return (
            <ApiProblem
              heading="ยังไม่มีบริษัทในระบบ workforce"
              detail="ต้องสร้างบริษัท (company) ก่อนถึงจะเพิ่มพนักงานได้ — สร้างผ่าน POST /companies"
            />
          );
        }

        const today = new Date().toISOString().slice(0, 10);

        return (
          <form action={createEmployeeAction} className="flex flex-col gap-4">
            <input type="hidden" name="company_id" value={company.id} />

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-(--ink)">
                ข้อมูลส่วนตัว
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="ชื่อ *">
                  <input name="first_name" required maxLength={100} className={inputClass} />
                </Field>
                <Field label="นามสกุล *">
                  <input name="last_name" required maxLength={100} className={inputClass} />
                </Field>
                <Field label="ชื่อเล่น">
                  <input name="preferred_name" maxLength={100} className={inputClass} />
                </Field>
                <Field label="วันเกิด">
                  <input type="date" name="date_of_birth" className={inputClass} />
                </Field>
                <Field label="อีเมล">
                  <input type="email" name="email" maxLength={200} className={inputClass} />
                </Field>
                <Field label="เบอร์โทร">
                  <input name="phone" maxLength={32} className={inputClass} />
                </Field>
                <Field
                  label="เลขบัตรประชาชน"
                  hint="เก็บเข้ารหัส ไม่ถูกส่งกลับมาแสดงที่ไหนอีก"
                >
                  <input name="national_id" maxLength={32} className={inputClass} />
                </Field>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-(--ink)">
                การจ้างงาน
              </h2>
              <p className="mb-3 text-xs text-(--ink-soft)">
                บริษัท: <span className="font-medium">{company.display_name}</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="รหัสพนักงาน *">
                  <input
                    name="employee_code"
                    required
                    maxLength={32}
                    placeholder="EMP-001"
                    className={`${inputClass} font-mono`}
                  />
                </Field>
                <Field label="ประเภทการจ้าง *">
                  <select name="employment_type" defaultValue="MONTHLY" className={selectClass}>
                    <option value="MONTHLY">รายเดือน</option>
                    <option value="DAILY">รายวัน</option>
                    <option value="HOURLY">รายชั่วโมง</option>
                  </select>
                </Field>
                <Field label="วันเริ่มงาน *">
                  <input
                    type="date"
                    name="hired_on"
                    required
                    defaultValue={today}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="ฐานค่าจ้าง"
                  hint="เว้นว่างได้ แต่ต้องตั้งก่อนคำนวณเงินเดือน"
                >
                  <input
                    name="amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    className={inputClass}
                  />
                </Field>
              </div>
            </Card>

            <div>
              <Button type="submit" className="w-full sm:w-48">
                เพิ่มพนักงาน
              </Button>
            </div>
          </form>
        );
      }}
    />
  );
}
