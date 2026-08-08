import type { ComponentType } from "react";
import type { ReportWidgetId } from "@/modules/report_task/store/report-layout-store";
import { ReportKpis } from "./report-kpis";
import { ReportsTable } from "./reports-table";
import { StatusDonutCard } from "./status-donut-card";
import { BarListCard } from "./bar-list-card";
import { buildDepartmentChart, buildMemberChart, buildPriorityChart } from "@/modules/report_task/lib/report-charts";
import { useReportTasks, useActiveValue } from "@/modules/report_task/lib/report-filter";

// Each chart card needs its own scoped data (cross-filter: a facet keeps
// showing all its own options even while others narrow) — thin wrappers so
// the grid can render each one as a standalone, prop-less widget.
function StatusDonutWidget() {
  const tasks = useReportTasks("status");
  const activeId = useActiveValue("status");
  return <StatusDonutCard tasks={tasks} activeId={activeId} />;
}

function PriorityBarWidget() {
  const tasks = useReportTasks("priority");
  const activeId = useActiveValue("priority");
  const rows = buildPriorityChart(tasks);
  return (
    <BarListCard
      title="ความสำคัญ"
      subtitle="ความยาวแถบ = ปริมาณงาน · ส่วนเขียว = เสร็จสิ้น"
      rows={rows}
      sort={false}
      dim="priority"
      activeId={activeId}
    />
  );
}

function DepartmentBarWidget() {
  const tasks = useReportTasks("department");
  const activeId = useActiveValue("department");
  const rows = buildDepartmentChart(tasks);
  return (
    <BarListCard
      title="แผนก"
      subtitle="ความยาวแถบ = ปริมาณงาน · ส่วนเขียว = เสร็จสิ้น"
      rows={rows}
      dim="department"
      activeId={activeId}
    />
  );
}

function MemberBarWidget() {
  const tasks = useReportTasks("member");
  const activeId = useActiveValue("member");
  const rows = buildMemberChart(tasks);
  return (
    <BarListCard
      title="รายบุคคล"
      subtitle="ความยาวแถบ = ปริมาณงาน · ส่วนเขียว = เสร็จสิ้น"
      rows={rows}
      dim="member"
      activeId={activeId}
    />
  );
}

export const reportWidgetRegistry: Record<ReportWidgetId, { label: string; Component: ComponentType }> = {
  kpi: { label: "การ์ดสรุปตัวเลขงาน", Component: ReportKpis },
  statusDonut: { label: "สถานะงาน (โดนัท)", Component: StatusDonutWidget },
  priorityBar: { label: "ความสำคัญ", Component: PriorityBarWidget },
  departmentBar: { label: "แผนก", Component: DepartmentBarWidget },
  memberBar: { label: "รายบุคคล", Component: MemberBarWidget },
  table: { label: "ตารางรายละเอียด", Component: ReportsTable },
};
