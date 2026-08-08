import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { Button } from "@smartboss/ui/components/button";
import {
  wfTry,
  type AttendanceSummary,
  type Company,
  type Employment,
  type Paged,
  type PayrollRun,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Field,
  SectionCard,
  StatCard,
  StatusBadge,
  Td,
  inputClass,
} from "@/modules/hr/components/ui";
import { createCompanyAction } from "./actions";
import { formatMinutes, runTypeLabel } from "@/modules/hr/lib/labels";

/** ยังไม่มี company ในระบบ — พาผู้ใช้ตั้งต้นให้จบในหน้าเดียว */
function SetupCompany() {
  return (
    <SectionCard
      title="ตั้งต้นระบบบุคคล"
      description="ยังไม่มีนิติบุคคลในระบบ — สร้างก่อนถึงจะเพิ่มพนักงาน กะทำงาน และงวดจ่ายได้"
    >
      <form
        action={createCompanyAction}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <Field label="รหัสบริษัท *" hint="ตัวพิมพ์ใหญ่">
          <input
            name="code"
            required
            maxLength={32}
            placeholder="MAIN"
            className={`${inputClass} font-mono uppercase`}
          />
        </Field>
        <Field label="ชื่อจดทะเบียน *">
          <input
            name="legal_name"
            required
            maxLength={200}
            placeholder="บริษัท ตัวอย่าง จำกัด"
            className={inputClass}
          />
        </Field>
        <Field label="ชื่อที่ใช้แสดง *">
          <input
            name="display_name"
            required
            maxLength={120}
            placeholder="ตัวอย่าง"
            className={inputClass}
          />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" className="sm:w-40">
            สร้างบริษัท
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/** ช่วงวันย้อนหลัง N วันในรูปแบบ ISO date */
function rangeForDays(days: number): { from: string; to: string } {
  const today = new Date();
  const past = new Date(today.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(past), to: iso(today) };
}

export default async function HrOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: daysParam } = await searchParams;
  const days = [7, 30, 90].includes(Number(daysParam)) ? Number(daysParam) : 30;

  return (
    <HrPage title="ระบบบุคคล" permission={HR_PERMS.access} load={async () => {
      const range = rangeForDays(days);

      // ผู้ใช้แต่ละคนมีสิทธิ์ไม่เท่ากัน — ส่วนที่ไม่มีสิทธิ์คืน null แล้วซ่อนไป
      const [employments, runs, summary, companies] = await Promise.all([
        wfTry<Paged<Employment>>("/employments"),
        wfTry<Paged<PayrollRun>>("/payroll-runs"),
        wfTry<AttendanceSummary>(
          `/attendance-summary?from=${range.from}&to=${range.to}`
        ),
        wfTry<Paged<Company>>("/companies"),
      ]);

      // ยังไม่มี company = ระบบยังตั้งต้นไม่เสร็จ ทำอะไรต่อไม่ได้เลย
      if (companies !== null && companies.items.length === 0) {
        return <SetupCompany />;
      }

      const active = (employments?.items ?? []).filter((e) => e.status === "ACTIVE");
      const totals = summary?.totals;

      return (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="พนักงานที่ทำงานอยู่"
              value={active.length}
              hint={
                employments ? `ทั้งหมด ${employments.items.length} คน` : "ไม่มีสิทธิ์ดู"
              }
              href="/hr/employees"
              tone="var(--app)"
            />
            <StatCard
              label="ชั่วโมงทำงานรวม"
              value={totals ? formatMinutes(totals.worked_minutes) : "—"}
              hint={`ย้อนหลัง ${days} วัน`}
              href="/hr/attendance"
              tone="var(--tone-ok)"
            />
            <StatCard
              label="มาสาย"
              value={totals ? `${totals.late_days} วัน` : "—"}
              hint={totals ? formatMinutes(totals.late_minutes) : undefined}
              href="/hr/attendance"
              tone="var(--tone-warn)"
            />
            <StatCard
              label="ขาดงาน"
              value={totals ? `${totals.absent_days} วัน` : "—"}
              hint={totals ? `OT ${formatMinutes(totals.ot_minutes)}` : undefined}
              href="/hr/attendance"
              tone="var(--tone-danger)"
            />
          </div>

          {/* ช่วงเวลาที่ใช้สรุป */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-(--ink-soft)">ช่วงเวลา:</span>
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={`/hr?days=${d}`}
                className="rounded-full border px-3 py-1 text-xs transition-colors"
                style={
                  d === days
                    ? {
                        color: "var(--app-strong)",
                        borderColor: "var(--app)",
                        backgroundColor: "var(--app-soft)",
                      }
                    : { color: "var(--ink-soft)", borderColor: "var(--line)" }
                }
              >
                {d} วัน
              </Link>
            ))}
          </div>

          {/* งวดเงินเดือนล่าสุด */}
          {runs && (
            <>
              <div className="mb-2 mt-6 flex items-center justify-between">
                <h2 className="text-base font-bold text-(--ink)">
                  งวดเงินเดือนล่าสุด
                </h2>
                <Link
                  href="/hr/payroll"
                  className="text-sm text-(--app-strong) hover:underline"
                >
                  ดูทั้งหมด
                </Link>
              </div>
              {runs.items.length === 0 ? (
                <EmptyState>ยังไม่มีงวดเงินเดือน</EmptyState>
              ) : (
                <div className="flex flex-col gap-2">
                  {runs.items.slice(0, 5).map((run) => (
                    <Link key={run.id} href={`/hr/payroll/${run.id}`}>
                      <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-(--bg-soft)">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-(--ink)">
                            {run.period_name ?? run.period_id.slice(0, 8)}
                          </p>
                          <p className="truncate text-xs text-(--ink-soft)">
                            {runTypeLabel(run.run_type)}
                          </p>
                        </div>
                        <StatusBadge value={run.status} />
                        <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}

          {/* สรุปรายคน */}
          {summary && summary.employees.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-base font-bold text-(--ink)">
                สรุปการลงเวลารายคน
              </h2>
              <DataTable
                head={["พนักงาน", "วันทำงาน", "ชั่วโมงทำงาน", "มาสาย", "ขาด", "OT"]}
              >
                {summary.employees.slice(0, 10).map((row) => {
                  const person = (employments?.items ?? []).find(
                    (e) => e.id === row.employment_id
                  );
                  return (
                    <tr key={row.employment_id} className="hover:bg-(--bg-soft)">
                      <Td>
                        <span className="font-medium">
                          {person?.full_name ?? row.employment_id.slice(0, 8)}
                        </span>
                        {person && (
                          <span className="ml-2 font-mono text-xs text-(--ink-soft)">
                            {person.employee_code}
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        {row.worked_days}/{row.days}
                      </Td>
                      <Td align="right">{formatMinutes(row.worked_minutes)}</Td>
                      <Td align="right">
                        {row.late_days > 0 ? (
                          <span style={{ color: "var(--tone-warn)" }}>
                            {row.late_days} วัน
                          </span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td align="right">
                        {row.absent_days > 0 ? (
                          <span style={{ color: "var(--tone-danger)" }}>
                            {row.absent_days} วัน
                          </span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td align="right">{formatMinutes(row.ot_minutes)}</Td>
                    </tr>
                  );
                })}
              </DataTable>
            </>
          )}
        </>
      );
    }} />
  );
}
