import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { HrPage } from "@/modules/hr/components/hr-page";
import { HR_PERMS } from "@/modules/hr/permissions";
import { wfFetch, type Paged, type PayrollRun } from "@/modules/hr/lib/api";
import { EmptyState, StatusBadge } from "@/modules/hr/components/ui";
import { formatDate, runTypeLabel } from "@/modules/hr/lib/labels";

interface PayrollRunRow extends PayrollRun {
  period_name?: string;
  pay_date?: string;
}

export default async function PayrollRunsPage() {
  return (
    <HrPage
      title="งวดเงินเดือน"
      permission={HR_PERMS.payrollView}
      width="max-w-3xl"
      load={async () => {
        const runs = await wfFetch<Paged<PayrollRunRow>>("/payroll-runs");

        if (runs.items.length === 0) {
          return (
            <EmptyState>
              ยังไม่มีงวดเงินเดือน — งวดจ่ายผูกกับงวด timesheet ที่ปิดแล้ว
            </EmptyState>
          );
        }

        return (
          <div className="flex flex-col gap-2">
            {runs.items.map((run) => (
              <Link key={run.id} href={`/hr/payroll/${run.id}`}>
                <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-(--bg-soft)">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-(--ink)">
                      {run.period_name ?? run.period_id.slice(0, 8)}
                    </p>
                    <p className="truncate text-xs text-(--ink-soft)">
                      {runTypeLabel(run.run_type)}
                      {run.pay_date ? ` · จ่าย ${formatDate(run.pay_date)}` : ""}
                      {run.locked_at ? " · ล็อกแล้ว" : ""}
                    </p>
                  </div>
                  <StatusBadge value={run.status} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-soft)" />
                </Card>
              </Link>
            ))}
          </div>
        );
      }}
    />
  );
}
