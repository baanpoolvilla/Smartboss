import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { Card } from "@smartboss/ui/components/card";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  type AttendanceCorrection,
  type Company,
  type Paged,
  type PayrollRun,
  type TimesheetPeriod,
} from "@/modules/hr/lib/api";
import {
  EmptyState,
  NoPermission,
  NotProvisioned,
  Pill,
  StatusBadge,
} from "@/modules/hr/components/ui";
import { formatDate, runTypeLabel } from "@/modules/hr/lib/labels";
import { generateTimesheetAction } from "../actions";
import { CreatePeriodButton } from "./create-period-button";
import { ClosePeriodButton } from "./close-period-button";

const STAGE_LABELS = ["สร้างงวด", "ตรวจเวลา", "ปิดงวด & คำนวณ", "สลิป & จ่าย"] as const;

interface PayrollRunRow extends PayrollRun {
  pay_date?: string;
}

/** งวดหนึ่งงวดอยู่ขั้นไหนใน 4 ขั้นของรอบจ่าย — ใช้วาดจุดสถานะเท่านั้น ไม่ผูกกับ logic จริง */
function stageOf(period: TimesheetPeriod, run: PayrollRunRow | undefined): number {
  if (period.status === "OPEN" || period.status === "REOPENED") return 1;
  if (!run || run.status === "DRAFT" || run.status === "CALCULATED") return 2;
  if (run.status === "APPROVED" || run.status === "LOCKED") return 3;
  return 2; // REVIEW ฯลฯ — ยังอยู่ระหว่างเตรียม/รออนุมัติ
}

function StageDots({ stage }: { stage: number }) {
  return (
    <div className="flex items-center gap-1" title={STAGE_LABELS[stage]}>
      {STAGE_LABELS.map((label, i) => (
        <span
          key={label}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: i <= stage ? "var(--app,var(--tone-info))" : "var(--line)" }}
        />
      ))}
      <span className="ml-1.5 text-[11px] text-(--ink-soft)">{STAGE_LABELS[stage]}</span>
    </div>
  );
}

/**
 * รอบจ่าย — รวม "Timesheet" (เดิม /hr/timesheets) กับ "เงินเดือน" (เดิม
 * /hr/payroll แบบแค่ list) เป็นหน้าเดียวตาม IA ใหม่ ไม่ต้องสลับเมนูระหว่างทำ
 * รอบจ่ายเดือนเดียวกัน (สเปคข้อ 4.7)
 *
 * ทั้งสองฝั่งมีสิทธิ์คนละชุด (employeeView/employeeManage สำหรับตรวจเวลา,
 * payrollView/payrollManage/payrollApprove สำหรับงวดเงินเดือน) — เพจนี้ยังคง
 * ทั้งสองด่านไว้ตรงจุดเดิมทุกประการ แค่ย้ายมาแสดงในหน้าเดียวกัน (เหมือนวิธีที่
 * ทำกับ /hr และ /hr/employees ตอนยุบ tab)
 */
export default async function PayrollPage() {
  const session = await requireOrg();
  const canManageTimesheet = hasPermission(session, HR_PERMS.employeeManage);
  const canViewPayroll = hasPermission(session, HR_PERMS.payrollView);

  return (
    <HrPage
      title="รอบจ่าย"
      permission={HR_PERMS.employeeView}
      load={async () => {
        const [periods, companies, runs, corrections] = await Promise.all([
          wfFetch<Paged<TimesheetPeriod>>("/timesheet-periods"),
          wfTry<Paged<Company>>("/companies"),
          canViewPayroll ? wfFetch<Paged<PayrollRunRow>>("/payroll-runs") : Promise.resolve(null),
          canManageTimesheet
            ? wfTry<{ items: AttendanceCorrection[] }>("/attendance-correction-requests")
            : Promise.resolve(null),
        ]);
        const companyId = companies?.items[0]?.id;

        if (companies !== null && companyId === undefined) {
          return <NotProvisioned what="สร้างรอบจ่าย" />;
        }

        const runByPeriod = new Map((runs?.items ?? []).map((r) => [r.period_id, r]));
        const pendingCorrections = (corrections?.items ?? []).filter((c) => c.status === "PENDING");

        const sortedPeriods = [...periods.items].sort((a, b) =>
          b.starts_on.localeCompare(a.starts_on),
        );

        if (sortedPeriods.length === 0) {
          return (
            <EmptyState
              icon={<span className="text-2xl">💰</span>}
              action={
                companyId ? <CreatePeriodButton companyId={companyId} /> : undefined
              }
            >
              ยังไม่มีงวด — สร้างงวดแรก แล้วทำตามขั้นตอน: ตรวจเวลา → ปิดงวด & คำนวณ →
              สลิป & จ่าย
            </EmptyState>
          );
        }

        return (
          <div className="flex flex-col gap-4">
            {canManageTimesheet && companyId && (
              <div className="flex justify-end">
                <CreatePeriodButton companyId={companyId} />
              </div>
            )}

            {pendingCorrections.length > 0 && (
              <Card className="flex items-start gap-3 border-(--tone-warn)/35 bg-(--tone-warn)/10 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-(--ink)">
                    มีคำขอแก้เวลาค้างอยู่ {pendingCorrections.length} รายการ
                  </p>
                  <p className="mt-0.5 text-sm text-(--ink-soft)">
                    ควรเคลียร์ให้ครบก่อนปิดงวด — ไม่งั้นตัวเลขที่ตรึงไว้จะไม่รวมการแก้ไขล่าสุด
                  </p>
                </div>
                <Link href="/hr?tab=corrections" className="ml-auto shrink-0">
                  <Button size="sm" variant="outline">ไปที่คำขอแก้เวลา</Button>
                </Link>
              </Card>
            )}

            {sortedPeriods.map((period) => {
              const run = runByPeriod.get(period.id);
              const stage = stageOf(period, run);
              const canEditThisPeriod = period.status === "OPEN" || period.status === "REOPENED";

              return (
                <Card key={period.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-(--ink)">{period.name}</p>
                      <p className="text-xs text-(--ink-soft)">
                        {formatDate(period.starts_on)} – {formatDate(period.ends_on)}
                      </p>
                      <div className="mt-1.5">
                        <StageDots stage={stage} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={period.status} />
                      {run && <Pill tone="var(--tone-muted)">{runTypeLabel(run.run_type)} · <StatusBadge value={run.status} /></Pill>}
                    </div>
                  </div>

                  {canManageTimesheet && canEditThisPeriod && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-(--line) pt-3">
                      <form action={generateTimesheetAction}>
                        <input type="hidden" name="periodId" value={period.id} />
                        <Button type="submit" size="sm" variant="outline">
                          คำนวณผลลงเวลา
                        </Button>
                      </form>
                      <ClosePeriodButton periodId={period.id} periodName={period.name} />
                    </div>
                  )}

                  {!canEditThisPeriod && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-(--line) pt-3">
                      <span className="text-xs text-(--ink-soft)">ปิดแล้ว — แก้ไขไม่ได้</span>
                      {canViewPayroll && run && (
                        <Link href={`/hr/payroll/${run.id}`} className="flex items-center gap-1 text-sm text-(--app-strong,var(--ink)) hover:underline">
                          ดูรายละเอียดงวดเงินเดือน <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {canViewPayroll && !run && (
                        <span className="text-xs text-(--ink-soft)">ยังไม่มีงวดเงินเดือนสำหรับช่วงนี้</span>
                      )}
                      {!canViewPayroll && (
                        <NoPermission what="งวดเงินเดือน" />
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        );
      }}
    />
  );
}
