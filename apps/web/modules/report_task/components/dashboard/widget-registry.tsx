import type { ComponentType } from "react";
import type { WidgetId } from "@/modules/report_task/store/dashboard-layout-store";
import { ExecutiveKpiRow } from "./executive-kpi-row";
import { SystemKpiSummary } from "./system-kpi-summary";
import { TaskStatusPie } from "./task-status-pie";
import { ReportFeedStatusPie } from "./report-feed-status-pie";
import { EscalationsPanel } from "./escalations-panel";
import { ReportFeedPendingTodayCard } from "./report-feed-pending-today-card";
import { RecentActivity } from "./recent-activity";
import { DepartmentBarChart } from "./department-bar-chart";
import { MyTasks } from "./my-tasks";
import { UpcomingDeadlines } from "./upcoming-deadlines";
import { TeamLeaderboard } from "./team-leaderboard";
import { ReportFeedDepartmentBar } from "./report-feed-department-bar";

// Every widget on the Dashboard — KPIs, analytics, operations, activity, and
// the department/ranking/personal-task extras — lives in this one registry,
// so all of it can be reordered/resized/hidden via "ปรับแต่ง".
export const widgetRegistry: Record<WidgetId, { label: string; Component: ComponentType }> = {
  executiveKpi: { label: "การ์ดสรุปตัวเลข (งาน + Report)", Component: ExecutiveKpiRow },
  systemKpiSummary: { label: "KPI รวมของระบบ (Task + Report)", Component: SystemKpiSummary },
  taskOverview: { label: "ภาพรวมงาน (โดนัท)", Component: TaskStatusPie },
  reportOverview: { label: "ภาพรวม Report (โดนัท)", Component: ReportFeedStatusPie },
  overdueTasks: { label: "งานที่ต้องเร่งติดตาม", Component: EscalationsPanel },
  pendingReports: { label: "ยังไม่ส่งวันนี้", Component: ReportFeedPendingTodayCard },
  recentActivity: { label: "กิจกรรมล่าสุด", Component: RecentActivity },
  deptBar: { label: "ผลงานแยกตามแผนก", Component: DepartmentBarChart },
  reportDeptBar: { label: "การส่งรายงานแยกตามแผนก", Component: ReportFeedDepartmentBar },
  leaderboard: { label: "อันดับทีม", Component: TeamLeaderboard },
  myTasks: { label: "งานของฉัน", Component: MyTasks },
  deadlines: { label: "กำหนดส่งที่ใกล้ถึง", Component: UpcomingDeadlines },
};
