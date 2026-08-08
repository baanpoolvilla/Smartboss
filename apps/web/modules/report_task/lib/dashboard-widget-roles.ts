import { canManage, isOwner } from "@/modules/report_task/data/mock";
import type { WidgetId } from "@/modules/report_task/store/dashboard-layout-store";

/**
 * Cross-department comparison only means something company-wide — a
 * department head's own data scope (canSeeTask/canSeeReportTopic) never
 * includes another department's tasks or posts, so a "compare every
 * department" chart would render as one populated bar and the rest empty
 * for a head, not a real comparison. Owner-only, not just any manager.
 */
export const OWNER_ONLY_WIDGETS: WidgetId[] = ["deptBar", "reportDeptBar"];

/**
 * Cross-person ranking/aggregate — meaningful once you're responsible for
 * more than just your own work (a department head ranking their own team,
 * or the owner's company-wide combined rate), not for a regular employee
 * whose own numbers are already the whole picture. Department heads AND
 * the owner both see these (each scoped to what they can already see via
 * canSeeTask/canSeeReportTopic — a head's ranking only ever includes their
 * own department).
 *
 * "ยังไม่ส่งวันนี้" (pendingReports) and "กิจกรรมล่าสุด" (recentActivity)
 * are here for a different reason than the ranking ones above: both are
 * flat, company-wide, unscoped-by-task-visibility feeds that name specific
 * people and what they did (score penalties, reassignments, sticker flags,
 * who hasn't posted where) — recentActivity reads the exact same
 * useActivityLogStore data as /activity-log's full log, which is already
 * ManagerOnlyGate-only for this reason, so the dashboard widget needs the
 * same gate rather than exposing that feed to every employee by default.
 */
export const MANAGER_ONLY_WIDGETS: WidgetId[] = ["leaderboard", "pendingReports", "systemKpiSummary", "recentActivity"];

/**
 * Three-tier Dashboard widget visibility: employee < department head <
 * owner/CEO. Personal-scoped widgets (KPI cards, the two Overview donuts,
 * overdue tasks, my tasks, deadlines) are visible to everyone — they already
 * narrow to "what this viewer can see" via the underlying
 * canSeeTask/canSeeReportTopic permission functions, so a regular employee
 * only ever sees their own numbers there without needing a separate gate.
 */
export function canViewWidget(id: WidgetId, viewingAsUserId: string): boolean {
  if (OWNER_ONLY_WIDGETS.includes(id)) return isOwner(viewingAsUserId);
  if (MANAGER_ONLY_WIDGETS.includes(id)) return canManage(viewingAsUserId);
  return true;
}
