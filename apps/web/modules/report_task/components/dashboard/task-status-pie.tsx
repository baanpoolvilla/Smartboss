"use client";

import { useRouter } from "next/navigation";
import { taskKpiBuckets, taskBucketsByAssignee } from "@/modules/report_task/lib/kpi-buckets";
import { getUser } from "@/modules/report_task/lib/directory";
import { useDashboardTasks } from "@/modules/report_task/hooks/use-dashboard-tasks";
import { useVisibleTasks } from "@/modules/report_task/hooks/use-visible-tasks";
import { useTaskBoardIntentStore } from "@/modules/report_task/store/task-board-intent-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { filterTasksByDashboard } from "@/modules/report_task/lib/date-filter";
import { previousPeriodRange } from "@/modules/report_task/lib/dashboard-trend";
import { localDateStr } from "@/modules/report_task/lib/now";
import { KanbanSquare } from "lucide-react";
import { StatusOverviewDonut } from "./status-overview-donut";

/** Everyone tied for the most tasks in `map` — named, for "ตัวปัญหาหลัก" to
 * point at whoever's actually behind the bucket instead of just a total.
 * Usually one person; more than one only when they're genuinely tied. */
function topPeopleOf(map: Map<string, number>): { name: string; count: number }[] {
  const ranked = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const topCount = ranked[0]?.[1];
  return ranked.filter(([, count]) => count === topCount).map(([id, count]) => ({ name: getUser(id)?.name ?? id, count }));
}

/** "ภาพรวมงาน (Task)" — the Analytics section's left twin (§2.6; Report
 * Overview is its right-hand pair, same StatusOverviewDonut shape). */
export function TaskStatusPie() {
  const tasks = useDashboardTasks();
  const allTasks = useVisibleTasks();
  const router = useRouter();
  const setScrollToStatus = useTaskBoardIntentStore((s) => s.setScrollToStatus);
  const personId = useDashboardFilterStore((s) => s.personId);
  const departmentId = useDashboardFilterStore((s) => s.departmentId);
  const preset = useDashboardFilterStore((s) => s.preset);
  const customFrom = useDashboardFilterStore((s) => s.customFrom);
  const customTo = useDashboardFilterStore((s) => s.customTo);

  const buckets = taskKpiBuckets(tasks);
  const byAssignee = taskBucketsByAssignee(tasks);

  // Same previous-period comparison as the KPI card's own successRate trend
  // — null (no comparison shown) for the unbounded "ทั้งหมด" preset.
  const prevRange = previousPeriodRange(preset, customFrom, customTo);
  const prevSuccessRate = prevRange
    ? taskKpiBuckets(
        filterTasksByDashboard(allTasks, {
          personId,
          departmentId,
          preset: "custom",
          customFrom: localDateStr(prevRange.from),
          customTo: localDateStr(prevRange.to),
        })
      ).successRate
    : null;

  function goToStatus(key: string) {
    if (key === "onTime" || key === "lateDone") setScrollToStatus("done");
    else setScrollToStatus("todo");
    router.push("/tasks");
  }

  return (
    <StatusOverviewDonut
      title="ภาพรวมงาน (Task)"
      subtitle="สถานะงานทั้งหมด · คลิกเพื่อดูคอลัมน์นั้นในบอร์ดงาน"
      icon={<KanbanSquare className="h-4.5 w-4.5 text-[var(--ink-soft)]" />}
      buckets={buckets}
      labels={{
        onTime: "เสร็จ ตรงเวลา",
        lateDone: "เสร็จช้าแต่เลยกำหนด",
        pending: "ยังไม่เสร็จ ในกำหนด",
        overdue: "ยังไม่เสร็จ เลยกำหนด",
        exempt: "ยกเว้น",
      }}
      unitLabel="งาน"
      centerLabel="สำเร็จ"
      totalLabel={`${buckets.total} งาน`}
      emptyMessage="ยังไม่มีงานในช่วงเวลานี้"
      onSegmentClick={goToStatus}
      topPersonByBucket={{ overdue: topPeopleOf(byAssignee.overdue), pending: topPeopleOf(byAssignee.pending) }}
      prevSuccessRate={prevSuccessRate}
    />
  );
}
