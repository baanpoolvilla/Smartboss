import Link from "next/link";
import { requireOrg } from "@smartboss/auth";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { listOrgUsers } from "@/modules/admin/data/users";
import {
  wfFetch,
  wfTry,
  type Company,
  type Employment,
  type Paged,
  type Person,
} from "@/modules/hr/lib/api";
import {
  ApiProblem,
  EmptyState,
  Field,
  NotProvisioned,
  Pill,
  inputClass,
  selectClass,
} from "@/modules/hr/components/ui";
import { importEmployeesAction } from "../../actions";

/**
 * นำเข้าพนักงานจากบัญชีผู้ใช้ที่มีอยู่แล้วใน Smartboss
 *
 * บริษัทที่เพิ่งเปิดใช้โมดูลบุคคลมีผู้ใช้อยู่แล้วสิบกว่าคน การให้ไปพิมพ์ชื่อกับอีเมล
 * ซ้ำทีละคนที่ /hr/employees/new เป็นงานที่ระบบทำแทนได้เกือบหมด — เหลือแค่สามช่อง
 * ที่ `core.users` ไม่มีทางรู้ (รหัสพนักงาน วันเริ่มงาน ประเภทการจ้าง)
 *
 * คนที่ถูกนำเข้าไปแล้วยังแสดงอยู่แต่ติ๊กไม่ได้ เพื่อให้เห็นว่า "ครบหรือยัง"
 * ไม่ใช่หายไปเฉย ๆ แล้วต้องไปไล่เทียบกับหน้าผู้ใช้เอง
 */
export default async function ImportEmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; fail?: string; msg?: string }>;
}) {
  const { ok, fail, msg } = await searchParams;
  const session = await requireOrg();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <HrPage
      title="นำเข้าพนักงานจากผู้ใช้ในระบบ"
      permission={HR_PERMS.employeeManage}
      backHref="/hr/employees"
      load={async () => {
        const [companies, users, employments, people] = await Promise.all([
          wfFetch<Paged<Company>>("/companies"),
          listOrgUsers(session.orgId),
          wfTry<Paged<Employment>>("/employments"),
          wfTry<Paged<Person>>("/people"),
        ]);

        const company = companies.items[0];
        if (company === undefined) return <NotProvisioned what="นำเข้าพนักงาน" />;

        /*
         * "นำเข้าไปแล้ว" = มีทะเบียนจ้างงานอยู่จริง ไม่ใช่แค่มี person
         *
         * person ที่ไม่มี employment เกิดได้เมื่อการนำเข้ารอบก่อนล้มกลางทาง —
         * คนกลุ่มนั้นต้องยังติ๊กนำเข้าได้ ไม่งั้นจะค้างอยู่แบบนำเข้าซ้ำก็ไม่ได้
         * แก้เองก็ไม่ได้ (ตัว action ใช้ person เดิมซ้ำอยู่แล้ว ไม่สร้างใบใหม่)
         */
        const employedPersonIds = new Set(
          (employments?.items ?? []).map((row) => row.person_id)
        );
        const importedEmails = new Set(
          (people?.items ?? [])
            .filter((row) => row.email !== null && employedPersonIds.has(row.id))
            .map((row) => row.email!.toLowerCase())
        );

        const rows = users
          .filter((user) => user.isActive)
          .map((user) => ({
            ...user,
            imported: importedEmails.has(user.email.toLowerCase()),
          }));
        const pending = rows.filter((user) => !user.imported);

        return (
          <>
            {ok !== undefined && (
              <div className="mb-4">
                <ApiProblem
                  heading={`นำเข้าสำเร็จ ${ok} คน · ไม่สำเร็จ ${fail ?? 0} คน`}
                  detail={msg ?? undefined}
                />
              </div>
            )}

            <Card className="mb-4 p-4">
              <p className="text-sm text-(--ink)">
                ระบบเติมชื่อกับอีเมลจากบัญชีผู้ใช้ให้แล้ว เหลือกรอกเฉพาะสิ่งที่
                ทะเบียนผู้ใช้ไม่มี
              </p>
              <p className="mt-1 text-sm text-(--ink-soft)">
                <b>วันเริ่มงาน</b>ใช้คำนวณลงเวลา เงินเดือน และสิทธิ์ลาโดยตรง —
                ใส่วันจริงเท่านั้น ถ้ายังไม่รู้ให้ข้ามคนนั้นไปก่อน ดีกว่าใส่มั่วแล้วได้
                ตัวเลขผิดโดยไม่มีใครรู้ตัว
              </p>
            </Card>

            {pending.length === 0 ? (
              <EmptyState>
                ผู้ใช้ที่ใช้งานอยู่ทุกคนถูกนำเข้าเป็นพนักงานแล้ว
              </EmptyState>
            ) : (
              <form action={importEmployeesAction} className="flex flex-col gap-3">
                <input type="hidden" name="company_id" value={company.id} />

                {pending.map((user) => (
                  <Card key={user.id} className="p-4">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        name="pick"
                        value={user.id}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-(--ink)">
                          {user.name}
                        </span>
                        <span className="block truncate text-xs text-(--ink-soft)">
                          {user.email}
                        </span>
                      </span>
                      {user.roleNames.length > 0 && (
                        <Pill>{user.roleNames.join(", ")}</Pill>
                      )}
                    </label>

                    {/* ค่าที่ระบบเติมให้ ส่งไปกับฟอร์มโดยไม่ต้องให้พิมพ์ซ้ำ */}
                    <input type="hidden" name={`label.${user.id}`} value={user.name} />
                    <input type="hidden" name={`email.${user.id}`} value={user.email} />
                    <input
                      type="hidden"
                      name={`preferred_name.${user.id}`}
                      value={user.name}
                    />

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="ชื่อจริง *">
                        <input
                          name={`first_name.${user.id}`}
                          defaultValue={firstNameOf(user.name)}
                          maxLength={100}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="นามสกุล *" hint="ทะเบียนผู้ใช้ไม่มีข้อมูลนี้">
                        <input
                          name={`last_name.${user.id}`}
                          maxLength={100}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="รหัสพนักงาน *">
                        <input
                          name={`employee_code.${user.id}`}
                          maxLength={32}
                          placeholder="EMP-001"
                          className={`${inputClass} font-mono`}
                        />
                      </Field>
                      <Field label="วันเริ่มงาน *" hint="วันที่เริ่มงานจริง">
                        <input
                          type="date"
                          name={`hired_on.${user.id}`}
                          max={today}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="ประเภทการจ้าง *">
                        <select
                          name={`employment_type.${user.id}`}
                          defaultValue="MONTHLY"
                          className={selectClass}
                        >
                          <option value="MONTHLY">รายเดือน</option>
                          <option value="DAILY">รายวัน</option>
                          <option value="HOURLY">รายชั่วโมง</option>
                        </select>
                      </Field>
                      <Field label="ฐานค่าจ้าง" hint="เว้นว่างได้ ตั้งทีหลังก็ได้">
                        <input
                          name={`amount.${user.id}`}
                          inputMode="decimal"
                          placeholder="0.00"
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  </Card>
                ))}

                <div className="sticky bottom-3 flex justify-end">
                  <Button type="submit" className="w-full sm:w-auto">
                    นำเข้าคนที่เลือก
                  </Button>
                </div>
              </form>
            )}

            {rows.some((user) => user.imported) && (
              <>
                <h2 className="mb-2 mt-6 text-base font-bold text-(--ink)">
                  นำเข้าไปแล้ว
                </h2>
                <div className="flex flex-col gap-2">
                  {rows
                    .filter((user) => user.imported)
                    .map((user) => (
                      <Card key={user.id} className="flex items-center gap-3 p-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-(--ink)">
                            {user.name}
                          </span>
                          <span className="block truncate text-xs text-(--ink-soft)">
                            {user.email}
                          </span>
                        </span>
                        <Link
                          href="/hr/employees"
                          className="shrink-0 text-sm text-(--app-strong) hover:underline"
                        >
                          ดูทะเบียน
                        </Link>
                      </Card>
                    ))}
                </div>
              </>
            )}
          </>
        );
      }}
    />
  );
}

/**
 * เดาชื่อจริงจากชื่อบัญชี — เอาแค่คำแรกก่อนช่องว่างหรือขีด
 *
 * ชื่อบัญชีในระบบมักเป็น "ชื่อ-ชื่อเล่น-แผนก" (เช่น `Chayanun-กาย-MC`) ซึ่งไม่ใช่
 * ชื่อจริงตามบัตร — เติมให้เป็นจุดตั้งต้นเท่านั้น ผู้กรอกแก้ทับได้ทุกช่อง
 * และ **ไม่เดานามสกุลให้เลย** เพราะเดาผิดแล้วจะติดไปถึงสลิปกับแบบยื่นราชการ
 */
function firstNameOf(name: string): string {
  const first = name.trim().split(/[\s-]+/)[0] ?? "";
  return first.slice(0, 100);
}
