import type { ReportTopicVisibility } from "@/modules/report_task/store/report-feed-store";

export type TopicMode = "open" | "department" | "manager" | "person";

/**
 * Which visibility mode a room is in, derived the same way everywhere it
 * matters (settings dialog, report-feed header, the members dialog) so none
 * of them disagree about what a room's `visibility` shape means.
 */
export function topicModeOf(visibility: ReportTopicVisibility | undefined): TopicMode {
  if (visibility?.userIds?.length) return "person";
  if (visibility?.managerOnly) return "manager";
  if (visibility?.departmentIds?.length) return "department";
  return "open";
}
