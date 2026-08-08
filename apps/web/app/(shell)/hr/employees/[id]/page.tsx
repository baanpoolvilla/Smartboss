import { notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  WorkforceError,
  type Employment,
  type Paged,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  Field,
  NoPermission,
  SectionCard,
  StatusBadge,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import {
  employmentTypeLabel,
  formatDate,
  formatMoney,
} from "@/modules/hr/lib/labels";
import {
  addCompensationRateAction,
  terminateEmploymentAction,
} from "../../actions";

interface CompensationRate {
  id: string;
  employment_id: string;
  pay_basis: string;
  amount: string;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  note: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-(--ink-soft)">{label}</span>
      <span className="text-right font-medium text-(--ink)">{value}</span>
    </div>
  );
}

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  const canManage = hasPermission(session, HR_PERMS.employeeManage);
  const canManageSalary = hasPermission(session, HR_PERMS.salaryManage);

  return (
    <HrPage
      title="รายละเอียดพนักงาน"
      permission={HR_PERMS.employeeView}
      backHref="/hr/employees"
      width="max-w-3xl"
      load={async () => {
        let employment: Employment;
        try {
          employment = await wfFetch<Employment>(`/employments/${id}`);
        } catch (error) {
          if (error instanceof WorkforceError && error.status === 404) notFound();
          throw error;
        }

        // อัตราค่าจ้างเป็นข้อมูลอ่อนไหว — คนที่ไม่มีสิทธิ์จะได้ null
        const rates = await wfTry<Paged<CompensationRate>>(
          `/compensation-rates?employment_id=${id}`
        );

        return (
          <div className="flex flex-col gap-4">
            <SectionCard title="ข้อมูลการจ้าง">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-(--ink-soft)">
                  {employment.employee_code}
                </span>
                <StatusBadge value={employment.status} />
              </div>
              <Row label="ชื่อ-นามสกุล" value={employment.full_name} />
              <Row label="ชื่อที่แสดง" value={employment.display_name} />
              <Row
                label="ประเภทการจ้าง"
                value={employmentTypeLabel(employment.employment_type)}
              />
              <Row label="วันเริ่มงาน" value={formatDate(employment.hired_on)} />
              {employment.terminated_on && (
                <Row
                  label="วันพ้นสภาพ"
                  value={formatDate(employment.terminated_on)}
                />
              )}
              <Row label="เขตเวลา" value={employment.time_zone} />
            </SectionCard>

            <SectionCard
              title="อัตราค่าจ้าง"
              description="เก็บเป็นช่วงเวลาที่ไม่ทับกัน — งวดย้อนหลังจึงคำนวณด้วยอัตราที่ถูก ณ เวลานั้น"
            >
              {rates === null ? (
                <NoPermission what="อัตราค่าจ้าง" />
              ) : rates.items.length === 0 ? (
                <p className="text-sm text-(--ink-soft)">
                  ยังไม่มีการตั้งอัตราค่าจ้าง
                </p>
              ) : (
                <DataTable head={["ฐานการจ่าย", "จำนวน", "มีผลตั้งแต่", "ถึง", "หมายเหตุ"]}>
                  {rates.items.map((rate) => (
                    <tr key={rate.id} className="hover:bg-(--bg-soft)">
                      <Td>{employmentTypeLabel(rate.pay_basis)}</Td>
                      <Td align="right" className="font-medium">
                        {formatMoney(rate.amount)} {rate.currency}
                      </Td>
                      <Td>{formatDate(rate.effective_from)}</Td>
                      <Td>
                        {rate.effective_to ? formatDate(rate.effective_to) : "ปัจจุบัน"}
                      </Td>
                      <Td className="text-(--ink-soft)">{rate.note || "—"}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}

              {canManageSalary && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-(--app-strong)">
                    + ตั้ง/ปรับอัตราค่าจ้าง
                  </summary>
                  <form
                    action={addCompensationRateAction}
                    className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4"
                  >
                    <input type="hidden" name="employment_id" value={employment.id} />
                    <Field label="ฐานการจ่าย *">
                      <select
                        name="pay_basis"
                        defaultValue={employment.employment_type}
                        className={inputClass}
                      >
                        <option value="MONTHLY">รายเดือน</option>
                        <option value="DAILY">รายวัน</option>
                        <option value="HOURLY">รายชั่วโมง</option>
                      </select>
                    </Field>
                    <Field label="จำนวนเงิน *">
                      <input
                        name="amount"
                        required
                        inputMode="decimal"
                        placeholder="0.00"
                        className={inputClass}
                      />
                    </Field>
                    <Field label="มีผลตั้งแต่ *">
                      <input
                        type="date"
                        name="effective_from"
                        required
                        defaultValue={new Date().toISOString().slice(0, 10)}
                        className={inputClass}
                      />
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit">บันทึก</Button>
                    </div>
                    <Field label="หมายเหตุ">
                      <input name="note" maxLength={500} className={inputClass} />
                    </Field>
                  </form>
                  <p className="mt-2 text-xs text-(--ink-soft)">
                    ระบบจะปิดช่วงของอัตราเดิมให้อัตโนมัติ — ช่วงเวลาห้ามซ้อนกัน
                  </p>
                </details>
              )}
            </SectionCard>

            {canManage && employment.status === "ACTIVE" && (
              <SectionCard
                title="แจ้งพ้นสภาพ"
                description="ปิดสัญญาจ้าง — ประวัติและงวดที่จ่ายไปแล้วยังอยู่ครบ"
              >
                <form
                  action={terminateEmploymentAction}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                >
                  <input type="hidden" name="employment_id" value={employment.id} />
                  <Field label="วันที่พ้นสภาพ *">
                    <input
                      type="date"
                      name="terminated_on"
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field label="เหตุผล">
                    <input name="reason" maxLength={200} className={inputClass} />
                  </Field>
                  <div className="flex items-end">
                    <Button type="submit" variant="danger">
                      แจ้งพ้นสภาพ
                    </Button>
                  </div>
                </form>
              </SectionCard>
            )}
          </div>
        );
      }}
    />
  );
}
