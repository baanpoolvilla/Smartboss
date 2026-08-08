import { departments, getDepartment } from "@/modules/report_task/data/mock";

/**
 * Summarize a set of department ids into one short label — e.g. for a
 * meeting whose department is derived from its attendees' own departments.
 * "ทุกแผนก" only when literally every department is represented; otherwise
 * "หลายแผนก (N)" for a partial spread, so it's never mistaken for "all".
 */
export function departmentsLabel(departmentIds: string[]): string {
  const unique = [...new Set(departmentIds)];
  if (unique.length === 0) return "—";
  if (unique.length === 1) return getDepartment(unique[0]!)?.name ?? "—";
  if (unique.length >= departments.length) return "ทุกแผนก";
  return `หลายแผนก (${unique.length})`;
}
