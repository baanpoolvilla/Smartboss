import { canManage } from "@/modules/report_task/lib/directory";
import type { WidgetId } from "@/modules/report_task/store/dashboard-layout-store";

/**
 * Cross-person ranking/aggregate — meaningful once you're responsible for
 * more than just your own work (a department head ranking their own team,
 * or the owner's company-wide combined rate), not for a regular employee
 * whose own numbers are already the whole picture. Department heads AND
 * the owner both see these (each scoped to what they can already see via
 * canSeeTask/canSeeReportTopic — a head's ranking only ever includes their
 * own department).
 *
 * "รายงานที่ยังไม่ส่ง" (pendingReports) is here for a different reason than
 * the ranking one above: it's a flat, company-wide, unscoped-by-task-
 * visibility feed that names specific people and what they haven't done,
 * so it needs the same manager gate as the rest of that kind of feed rather
 * than being exposed to every employee by default.
 */
export const MANAGER_ONLY_WIDGETS: WidgetId[] = ["pendingReports", "systemKpiSummary"];

/**
 * Two-tier Dashboard widget visibility: employee < manager (department head
 * or owner). Personal-scoped widgets (the two Overview donuts, overdue
 * tasks) are visible to everyone — they already narrow to "what this viewer
 * can see" via the underlying canSeeTask/canSeeReportTopic permission
 * functions, so a regular employee only ever sees their own numbers there
 * without needing a separate gate.
 */
export function canViewWidget(id: WidgetId, viewingAsUserId: string): boolean {
  if (MANAGER_ONLY_WIDGETS.includes(id)) return canManage(viewingAsUserId);
  return true;
}
