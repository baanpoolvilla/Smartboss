import type { ComponentType } from "react";
import type { WidgetId } from "@/modules/report_task/store/dashboard-layout-store";
import { SystemKpiSummary } from "./system-kpi-summary";
import { AiInsightCard } from "./ai-insight-card";
import { TaskStatusPie } from "./task-status-pie";
import { ReportFeedStatusPie } from "./report-feed-status-pie";
import { ReportFeedPendingTodayCard } from "./report-feed-pending-today-card";

// Every widget on the Dashboard lives in this one registry, so all of it can
// be reordered/resized/hidden via "ปรับแต่ง". Task and Report Overview stay
// two separate donuts, each with its own domain-specific labels (Task's
// "เสร็จ ตรงเวลา/เลยกำหนด" vs Report's "ส่งแล้ว ตรงเวลา/เลยกำหนด" — different
// wording for a real reason) — only the KPI summary bar below them merges
// the two domains into one combined view.
export const widgetRegistry: Record<WidgetId, { label: string; Component: ComponentType }> = {
  systemKpiSummary: { label: "KPI รวมของระบบ (Task + Report)", Component: SystemKpiSummary },
  aiInsight: { label: "AI Insight", Component: AiInsightCard },
  taskOverview: { label: "ภาพรวมงาน (โดนัท)", Component: TaskStatusPie },
  reportOverview: { label: "ภาพรวม Report (โดนัท)", Component: ReportFeedStatusPie },
  pendingReports: { label: "รายงานที่ยังไม่ส่ง", Component: ReportFeedPendingTodayCard },
};
