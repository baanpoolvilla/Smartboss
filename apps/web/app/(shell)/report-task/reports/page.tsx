"use client";

import { useState } from "react";
import { SlidersHorizontal, Check } from "lucide-react";
import { ReportFilterBanner } from "@/modules/report_task/components/report-analytics/report-filter-banner";
import { ReportDateFilter } from "@/modules/report_task/components/report-analytics/report-date-filter";
import { ReportsSkeleton } from "@/modules/report_task/components/report-analytics/reports-skeleton";
import { ReportPrintButton } from "@/modules/report_task/components/report-analytics/report-print-button";
import { ReportGrid } from "@/modules/report_task/components/report-analytics/report-grid";
import { ReportCustomizeBar } from "@/modules/report_task/components/report-analytics/report-customize-bar";
import { TaskDataGate } from "@/modules/report_task/components/shared/task-data-gate";
import { ReportFeedDataGate } from "@/modules/report_task/components/shared/report-feed-data-gate";
import { ManagerOnlyGate } from "@/modules/report_task/components/shared/manager-only-gate";
import { PageHeader } from "@/modules/report_task/components/shared/page-header";
import { Button } from "@/modules/report_task/components/ui/button";
import { cn } from "@/modules/report_task/lib/utils";

// The "Report" tab (who submitted/late/missed, company-wide) was pulled —
// it hung on open every time and wasn't worth chasing down further, so this
// page is back to just the "งาน" report it always was underneath.
export default function ReportsPage() {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-4 lg:gap-6 pb-6">
      <PageHeader
        title="รายงาน · งาน"
        subtitle="ติดตามอัตราความสำเร็จ ความล่าช้า และผลงานของทั้งทีม · คลิกที่กราฟใดก็ได้เพื่อกรองทั้งหน้า"
        action={
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={editing ? "default" : "outline"}
              size="sm"
              className={cn(editing && "bg-[var(--brand-green)] hover:bg-[var(--brand-green-dark)] text-[var(--ink)] hover:text-white")}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? <Check className="h-3.5 w-3.5" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
              {editing ? "เสร็จสิ้น" : "ปรับแต่ง"}
            </Button>
            <ReportPrintButton />
          </div>
        }
      />

      <ManagerOnlyGate>
        <TaskDataGate fallback={<ReportsSkeleton />}>
          <ReportFeedDataGate fallback={<ReportsSkeleton />}>
            <ReportDateFilter />
            <ReportFilterBanner />
            {editing && <ReportCustomizeBar />}
            <ReportGrid editing={editing} />
          </ReportFeedDataGate>
        </TaskDataGate>
      </ManagerOnlyGate>
    </div>
  );
}
