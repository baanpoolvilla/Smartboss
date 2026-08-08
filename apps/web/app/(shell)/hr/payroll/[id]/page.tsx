import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { requireOrg, hasPermission } from "@smartboss/auth";
import { Button } from "@smartboss/ui/components/button";
import { Card } from "@smartboss/ui/components/card";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import {
  wfFetch,
  wfTry,
  WorkforceError,
  type Employment,
  type Paged,
  type PayrollEmployeeResult,
} from "@/modules/hr/lib/api";
import {
  DataTable,
  EmptyState,
  Pill,
  SectionCard,
  StatCard,
  StatusBadge,
  Td,
} from "@/modules/hr/components/ui";
import {
  categoryLabel,
  formatDate,
  formatMoney,
  runTypeLabel,
} from "@/modules/hr/lib/labels";
import { payrollTransitionAction } from "../../actions";

interface RunDetail {
  id: string;
  period_id: string;
  period_name?: string;
  pay_date: string;
  run_type: string;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
  rejection_reason: string | null;
}

/**
 * ปุ่มที่แสดงขึ้นกับสถานะปัจจุบัน — สะท้อน state machine ฝั่งเซิร์ฟเวอร์
 * การซ่อนปุ่มเป็นเรื่อง UX ล้วน เซิร์ฟเวอร์ปฏิเสธซ้ำอยู่ดี
 *
 * needsApprove = true → ต้องมีสิทธิ์อนุมัติ (คนเตรียมงวดกดไม่ได้ ตามกฎแยกหน้าที่)
 */
const ACTIONS: {
  id: string;
  label: string;
  from: string[];
  needsApprove: boolean;
  danger?: boolean;
}[] = [
  { id: "snapshot", label: "ตรึงข้อมูล (snapshot)", from: ["DRAFT"], needsApprove: false },
  { id: "calculate", label: "คำนวณ", from: ["DRAFT", "CALCULATED"], needsApprove: false },
  { id: "submit", label: "ส่งตรวจ", from: ["CALCULATED"], needsApprove: false },
  { id: "approve", label: "อนุมัติ", from: ["REVIEW"], needsApprove: true },
  { id: "reject", label: "ตีกลับ", from: ["REVIEW"], needsApprove: true, danger: true },
  { id: "lock", label: "ล็อกงวด", from: ["APPROVED"], needsApprove: true },
];

export default async function PayrollRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireOrg();
  const canPrepare = hasPermission(session, HR_PERMS.payrollManage);
  const canApprove = hasPermission(session, HR_PERMS.payrollApprove);

  return (
    <HrPage
      title="รายละเอียดงวดเงินเดือน"
      permission={HR_PERMS.payrollView}
      backHref="/hr/payroll"
      load={async () => {
        let run: RunDetail;
        try {
          run = await wfFetch<RunDetail>(`/payroll-runs/${id}`);
        } catch (error) {
          if (error instanceof WorkforceError && error.status === 404) notFound();
          throw error;
        }

        const [results, employments] = await Promise.all([
          wfTry<Paged<PayrollEmployeeResult>>(`/payroll-runs/${id}/employees`),
          wfTry<Paged<Employment>>("/employments"),
        ]);

        const nameOf = (employmentId: string) =>
          (employments?.items ?? []).find((e) => e.id === employmentId)?.full_name ??
          employmentId.slice(0, 8);

        const rows = results?.items ?? [];
        const sum = (pick: (r: PayrollEmployeeResult) => string) =>
          rows.reduce((total, row) => total + Number(pick(row) || 0), 0);

        const available = ACTIONS.filter(
          (action) =>
            action.from.includes(run.status) &&
            (action.needsApprove ? canApprove : canPrepare)
        );

        return (
          <div className="flex flex-col gap-4">
            <SectionCard title="สถานะงวด">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge value={run.status} />
                <Pill tone="var(--tone-muted)">{runTypeLabel(run.run_type)}</Pill>
                {run.locked_at && (
                  <Pill tone="var(--tone-info)">
                    ล็อกเมื่อ {formatDate(run.locked_at)}
                  </Pill>
                )}
              </div>
              <p className="text-sm text-(--ink-soft)">
                งวด {run.period_name ?? run.period_id.slice(0, 8)} · จ่าย{" "}
                {formatDate(run.pay_date)}
              </p>

              {run.rejection_reason && (
                <div className="mt-3 flex items-start gap-2 rounded-(--radius) border border-(--danger-line) bg-(--danger-bg) p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-(--danger)" />
                  <p className="text-sm text-(--danger)">
                    ถูกตีกลับ: {run.rejection_reason}
                  </p>
                </div>
              )}

              {available.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {available.map((action) => (
                    <form key={action.id} action={payrollTransitionAction}>
                      <input type="hidden" name="runId" value={run.id} />
                      <input type="hidden" name="action" value={action.id} />
                      <Button
                        type="submit"
                        size="sm"
                        variant={action.danger ? "danger" : "primary"}
                      >
                        {action.label}
                      </Button>
                    </form>
                  ))}
                </div>
              )}

              {run.status === "LOCKED" && (
                <p className="mt-3 text-xs text-(--ink-soft)">
                  งวดที่ล็อกแล้วแก้ไม่ได้ทั้งจาก API และ DB trigger
                </p>
              )}
            </SectionCard>

            {rows.length > 0 && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="พนักงาน" value={rows.length} tone="var(--app)" />
                <StatCard
                  label="เงินได้รวม"
                  value={formatMoney(String(sum((r) => r.gross)))}
                  tone="var(--tone-ok)"
                />
                <StatCard
                  label="รายการหักรวม"
                  value={formatMoney(String(sum((r) => r.total_deduction)))}
                  tone="var(--tone-danger)"
                />
                <StatCard
                  label="จ่ายสุทธิ"
                  value={formatMoney(String(sum((r) => r.net_pay)))}
                  tone="var(--tone-info)"
                />
              </div>
            )}

            <SectionCard title="ยอดรายคน">
              {rows.length === 0 ? (
                <EmptyState>
                  ยังไม่มีผลคำนวณ — กด &quot;ตรึงข้อมูล&quot; แล้ว &quot;คำนวณ&quot;
                </EmptyState>
              ) : (
                <DataTable
                  head={["พนักงาน", "เงินได้", "รายการหัก", "นายจ้างสมทบ", "สุทธิ", ""]}
                >
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-(--bg-soft)">
                      <Td>
                        <span className="font-medium">{nameOf(row.employment_id)}</span>
                        {row.warnings.length > 0 && (
                          <span className="mt-1 block">
                            <Pill tone="var(--tone-warn)">
                              <AlertTriangle className="h-3 w-3" />
                              {row.warnings.length} คำเตือน
                            </Pill>
                          </span>
                        )}
                      </Td>
                      <Td align="right">{formatMoney(row.gross)}</Td>
                      <Td align="right" className="text-(--tone-danger)">
                        {formatMoney(row.total_deduction)}
                      </Td>
                      <Td align="right" className="text-(--ink-soft)">
                        {formatMoney(row.employer_contribution)}
                      </Td>
                      <Td align="right" className="font-bold">
                        {formatMoney(row.net_pay)}
                      </Td>
                      <Td>
                        <details>
                          <summary className="cursor-pointer text-xs text-(--app-strong)">
                            รายการ
                          </summary>
                          <div className="mt-2 flex flex-col gap-1">
                            {row.lines.map((line, i) => (
                              <div
                                key={`${line.code}-${i}`}
                                className="flex justify-between gap-3 text-xs"
                              >
                                <span className="text-(--ink-soft)">
                                  {line.name}
                                  <span className="ml-1 opacity-60">
                                    ({categoryLabel(line.category)})
                                  </span>
                                </span>
                                <span className="font-medium text-(--ink)">
                                  {formatMoney(line.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </SectionCard>

            {rows.some((r) => r.warnings.length > 0) && (
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold text-(--tone-warn)">
                  คำเตือนจากการคำนวณ
                </h3>
                <ul className="flex flex-col gap-1 text-xs text-(--ink-soft)">
                  {rows.flatMap((row) =>
                    row.warnings.map((warning, i) => (
                      <li key={`${row.id}-${i}`}>
                        <span className="font-medium text-(--ink)">
                          {nameOf(row.employment_id)}:
                        </span>{" "}
                        {warning}
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            )}
          </div>
        );
      }}
    />
  );
}
