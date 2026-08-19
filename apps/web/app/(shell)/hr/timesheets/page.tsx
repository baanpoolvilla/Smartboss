import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type Company,
  type Paged,
  type TimesheetPeriod,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Field,
  NotProvisioned,
  SectionCard,
  StatusBadge,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import { formatDate } from "@/modules/hr/lib/labels";
import {
  closeTimesheetAction,
  createTimesheetPeriodAction,
  generateTimesheetAction,
} from "../actions";

export default async function TimesheetsPage() {
  const session = await requireOrg();
  const canManage = hasPermission(session, HR_PERMS.employeeManage);

  return (
    <HrPage
      title="Timesheet"
      permission={HR_PERMS.employeeView}
      load={async () => {
        const [periods, companies] = await Promise.all([
          wfFetch<Paged<TimesheetPeriod>>("/timesheet-periods"),
          wfTry<Paged<Company>>("/companies"),
        ]);
        const companyId = companies?.items[0]?.id;

        // companies = null คือไม่มีสิทธิ์อ่าน ไม่ใช่ยังไม่ถูกตั้งต้น — คนละเรื่องกัน
        if (companies !== null && companyId === undefined) {
          return <NotProvisioned what="สร้างงวด timesheet" />;
        }

        return (
          <>
            <p className="mb-3 text-sm text-(--ink-soft)">
              ปิดงวดแล้วผลลงเวลาจะถูกตรึงเป็น snapshot — งวดเงินเดือนคำนวณจากข้อมูลชุดที่ตรึงแล้ว
              ไม่ใช่ข้อมูลสดที่ยังแก้ได้
            </p>

            {canManage && companyId && (
              <SectionCard title="สร้างงวดใหม่" className="mb-4">
                <form
                  action={createTimesheetPeriodAction}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-4"
                >
                  <input type="hidden" name="company_id" value={companyId} />
                  <Field label="ชื่องวด *">
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder="งวด ส.ค. 2569"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="ตั้งแต่ *">
                    <input type="date" name="starts_on" required className={inputClass} />
                  </Field>
                  <Field label="ถึง *">
                    <input type="date" name="ends_on" required className={inputClass} />
                  </Field>
                  <div className="flex items-end">
                    <Button type="submit">สร้างงวด</Button>
                  </div>
                </form>
              </SectionCard>
            )}

            {periods.items.length === 0 ? (
              <EmptyState>ยังไม่มีงวด timesheet</EmptyState>
            ) : (
            <DataTable
              head={["งวด", "ตั้งแต่", "ถึง", "สถานะ", ...(canManage ? ["จัดการ"] : [])]}
            >
              {periods.items.map((period) => (
                <tr key={period.id} className="hover:bg-(--bg-soft)">
                  <Td className="font-medium">{period.name}</Td>
                  <Td>{formatDate(period.starts_on)}</Td>
                  <Td>{formatDate(period.ends_on)}</Td>
                  <Td>
                    <StatusBadge value={period.status} />
                  </Td>
                  {canManage && (
                    <Td>
                      {period.status === "OPEN" || period.status === "REOPENED" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={generateTimesheetAction}>
                            <input type="hidden" name="periodId" value={period.id} />
                            <Button type="submit" size="sm" variant="outline">
                              คำนวณผลลงเวลา
                            </Button>
                          </form>
                          <form
                            action={closeTimesheetAction}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="periodId" value={period.id} />
                            <input
                              name="reason"
                              required
                              placeholder="เหตุผลที่ปิดงวด"
                              className="h-9 w-40 rounded-(--radius) border border-(--line) px-2 text-xs"
                            />
                            <Button type="submit" size="sm">
                              ปิดงวด
                            </Button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-xs text-(--ink-soft)">
                          ปิดแล้ว — แก้ไขไม่ได้
                        </span>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </DataTable>
            )}
          </>
        );
      }}
    />
  );
}
