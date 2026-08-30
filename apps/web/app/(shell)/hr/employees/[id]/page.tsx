import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  WorkforceError,
  type BiometricEnrollment,
  type Company,
  type Device,
  type Employment,
  type Paged,
  type Person,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Field,
  NoPermission,
  Pill,
  SectionCard,
  StatCard,
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
  deleteEnrollmentsAction,
  terminateEmploymentAction,
} from "../../actions";
import { AssignShiftForm } from "../../settings/assign-shift-form";
import { EnrollFingerprintForm } from "../../devices/enroll-fingerprint-form";
import { buildScorecards } from "@/lib/performance";

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

/** 480 → "08:00" · เกิน 1440 = ข้ามวัน */
function minutesToClock(minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const within = minutes - day * 1440;
  const text = `${String(Math.floor(within / 60)).padStart(2, "0")}:${String(within % 60).padStart(2, "0")}`;
  return day > 0 ? `${text} (+${day})` : text;
}

function deviceCodeOf(devices: Device[], deviceId: string): string {
  return devices.find((d) => d.id === deviceId)?.device_code ?? "เครื่อง";
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
      title="ตั้งค่าพนักงาน"
      permission={HR_PERMS.employeeView}
      backHref="/hr/employees"
      width="max-w-4xl"
      load={async () => {
        let employment: Employment;
        try {
          employment = await wfFetch<Employment>(`/employments/${id}`);
        } catch (error) {
          if (error instanceof WorkforceError && error.status === 404) notFound();
          throw error;
        }

        /*
         * รวมทุกอย่างของคนนี้ไว้หน้าเดียว — เดิมกระจายอยู่ 4 หน้า (ค่าจ้างที่นี่,
         * ตารางกะที่ /hr/shifts, วันหยุดที่ /hr/holidays, ลายนิ้วมือที่ /hr/devices)
         * ทำให้ตั้งค่าคนหนึ่งคนต้องเดินสี่หน้าและจำได้ยากว่าตั้งครบหรือยัง
         *
         * ทุกตัวเป็น wfTry — คนที่ดูทะเบียนพนักงานได้อาจไม่มีสิทธิ์ดูค่าจ้าง
         * หรือจัดการกะ ไม่ควรให้ 403 ตัวเดียวล้มทั้งหน้า
         */
        const [rates, companies, shifts, devices, enrollments, people] =
          await Promise.all([
            // อัตราค่าจ้างเป็นข้อมูลอ่อนไหว — คนที่ไม่มีสิทธิ์จะได้ null
            wfTry<Paged<CompensationRate>>(`/compensation-rates?employment_id=${id}`),
            wfTry<Paged<Company>>("/companies"),
            wfTry<Paged<{ id: string; code: string; name: string; rest_day: boolean; start_minutes: number; end_minutes: number }>>(
              "/shifts",
            ),
            wfTry<Paged<Device>>("/devices"),
            wfTry<Paged<BiometricEnrollment>>(`/biometric-enrollments?employment_id=${id}`),
            wfTry<Paged<Person>>("/people"),
          ]);

        const companyId = companies?.items[0]?.id;
        const shiftItems = shifts?.items ?? [];

        const liveEnrollments = (enrollments?.items ?? []).filter(
          (en) => en.status !== "DELETED",
        );
        const activeDevices = (devices?.items ?? []).filter((d) => d.status === "ACTIVE");

        /*
         * คะแนนผลงานอยู่ใน core.performance_events ซึ่งผูกกับ core.users.id
         * ส่วนทะเบียนจ้างงานอยู่ฝั่ง workforce — จับคู่ด้วยอีเมล ค่าเดียวที่ทั้งสอง
         * ระบบมีและไม่ซ้ำ (ตัวเดียวกับที่ provisionPrincipal และหน้านำเข้าใช้)
         */
        const email = (people?.items ?? [])
          .find((row) => row.id === employment.person_id)
          ?.email?.toLowerCase();
        const now = new Date();
        const scoreFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        const scorecard =
          email === undefined
            ? null
            : await buildScorecards(session.orgId, scoreFrom, now)
                .then((r) => r.cards.find((c) => c.email.toLowerCase() === email) ?? null)
                .catch(() => null);

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

            {scorecard !== null && (
              <SectionCard
                title="คะแนนผลงานเดือนนี้"
                description="คิดรวมจากงานซ่อมบำรุง งานในบอร์ด และการลงเวลา — ดูที่มาทุกแต้มได้ที่หน้าผลงานรายคน"
                action={
                  <Link href="/admin/performance">
                    <Button size="sm" variant="outline">
                      ดูรายละเอียด
                    </Button>
                  </Link>
                }
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatCard
                    label="เกรด"
                    value={scorecard.grade}
                    tone={
                      scorecard.grade === "F" ? "var(--danger)" : "var(--app-strong)"
                    }
                  />
                  <StatCard label="คะแนนรวม" value={String(scorecard.score)} />
                  <StatCard
                    label="เหตุการณ์ที่หักคะแนน"
                    value={String(scorecard.eventCount)}
                    hint={scorecard.eventCount === 0 ? "ไม่มีเลย" : "ครั้ง"}
                  />
                </div>

                {scorecard.byCategory.length > 0 && (
                  <div className="mt-3">
                    <DataTable head={["เสียคะแนนเพราะ", "จำนวนครั้ง", "คะแนน"]}>
                      {scorecard.byCategory.map((row) => (
                        <tr key={row.category} className="hover:bg-(--bg-soft)">
                          <Td>{row.label}</Td>
                          <Td align="right">{row.count}</Td>
                          <Td
                            align="right"
                            className="font-medium"
                            // แต้มติดลบคือสิ่งที่ต้องสังเกต ไม่ใช่ตัวเลขเฉย ๆ
                          >
                            <span
                              style={{
                                color: row.points < 0 ? "var(--danger)" : "var(--tone-ok)",
                              }}
                            >
                              {row.points > 0 ? `+${row.points}` : row.points}
                            </span>
                          </Td>
                        </tr>
                      ))}
                    </DataTable>
                  </div>
                )}
              </SectionCard>
            )}

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

            {/*
              ชื่อการ์ดต้องมีคำว่า "ผูกกะ" — หน้าลงเวลาเรียกสิ่งนี้ว่า "ยังไม่ผูกกะ"
              แล้วส่งคนมาที่นี่ แต่ทั้งหน้าไม่เคยมีคำนั้นโผล่สักที่ (หัวข้อเดิมคือ
              "ตารางกะประจำสัปดาห์" ปุ่มคือ "บันทึกตาราง") คนจึงกวาดตาหาไม่เจอ
              ทั้งที่ยืนอยู่บนมันแล้ว — ศัพท์สองหน้าจอต้องเป็นคำเดียวกัน
            */}
            <SectionCard
              title="ผูกกะ · ตารางกะประจำสัปดาห์"
              description="ระบบใช้ตารางนี้เทียบว่าคนนี้ควรเข้ากี่โมง — ไม่ผูกก็คิดสาย/ขาดไม่ได้"
            >
              {canManage ? (
                <AssignShiftForm
                  employments={[]}
                  lockedTo={id}
                  shifts={shiftItems.map((sh) => {
                    const base = sh.rest_day
                      ? `${sh.name} (วันหยุด)`
                      : `${sh.name} ${minutesToClock(sh.start_minutes)}-${minutesToClock(sh.end_minutes)}`;
                    /*
                     * บริษัทที่เผลอสร้างกะชื่อเวลาเดียวกันสองใบจะได้ตัวเลือกหน้าตา
                     * เหมือนกันเป๊ะ เลือกไม่ถูกว่าอันไหนคืออันไหน — ต่อรหัสกะให้
                     * เฉพาะตอนที่ชื่อชนกันจริง จะได้ไม่รกกับบริษัทที่ตั้งชื่อดีอยู่แล้ว
                     */
                    const duplicated =
                      shiftItems.filter(
                        (other) =>
                          other.name === sh.name &&
                          other.start_minutes === sh.start_minutes &&
                          other.end_minutes === sh.end_minutes,
                      ).length > 1;
                    return {
                      id: sh.id,
                      label: duplicated ? `${base} · ${sh.code}` : base,
                      restDay: sh.rest_day,
                    };
                  })}
                  today={new Date().toISOString().slice(0, 10)}
                />
              ) : (
                <p className="text-sm text-(--ink-soft)">ไม่มีสิทธิ์แก้ตารางกะ</p>
              )}
            </SectionCard>

            <SectionCard
              title="ลายนิ้วมือ"
              description="ต้องผูก slot บนเครื่องกับคนนี้ ระบบถึงจะรู้ว่าใครสแกน"
            >
              {liveEnrollments.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {liveEnrollments.map((en) => (
                    <Pill
                      key={en.id}
                      tone={en.status === "ACTIVE" ? "var(--tone-ok)" : "var(--tone-warn)"}
                    >
                      {deviceCodeOf(devices?.items ?? [], en.device_id)} · slot {en.template_slot} ·{" "}
                      {en.status === "ACTIVE" ? "ใช้งานได้" : "รอวางนิ้วที่เครื่อง"}
                    </Pill>
                  ))}
                  {canManage && (
                    <form action={deleteEnrollmentsAction}>
                      <input type="hidden" name="employmentId" value={id} />
                      <Button type="submit" size="sm" variant="danger">
                        ลบทุกเครื่อง
                      </Button>
                    </form>
                  )}
                </div>
              )}

              {canManage ? (
                <EnrollFingerprintForm
                  employments={[]}
                  lockedTo={id}
                  devices={activeDevices.map((d) => ({
                    id: d.id,
                    label: `${d.device_code}${d.name ? ` · ${d.name}` : ""}`,
                  }))}
                />
              ) : liveEnrollments.length === 0 ? (
                <EmptyState>ยังไม่ได้ผูกลายนิ้วมือ</EmptyState>
              ) : null}
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
