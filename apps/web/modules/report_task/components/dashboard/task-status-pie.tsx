"use client";

import { useRouter } from "next/navigation";
import { taskKpiBuckets, taskBucketsByAssignee } from "@/modules/report_task/lib/kpi-buckets";
import { getUser } from "@/modules/report_task/lib/directory";
import { useDashboardTasks } from "@/modules/report_task/hooks/use-dashboard-tasks";
import { useTaskBoardIntentStore } from "@/modules/report_task/store/task-board-intent-store";
import { KanbanSquare } from "lucide-react";
import { StatusOverviewDonut } from "./status-overview-donut";

/** Whoever has the most tasks in `map` — named, for "ตัวปัญหาหลัก" to point
 * at a specific person instead of just a bucket total. */
function topPersonOf(map: Map<string, number>): { name: string; count: number } | undefined {
  const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return undefined;
  return { name: getUser(top[0])?.name ?? top[0], count: top[1] };
}

/** "ภาพรวมงาน (Task)" — the Analytics section's left twin (§2.6; Report
 * Overview is its right-hand pair, same StatusOverviewDonut shape). */
export function TaskStatusPie() {
  const tasks = useDashboardTasks();
  const router = useRouter();
  const setScrollToStatus = useTaskBoardIntentStore((s) => s.setScrollToStatus);

  const buckets = taskKpiBuckets(tasks);
  const byAssignee = taskBucketsByAssignee(tasks);

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
      topPersonByBucket={{ overdue: topPersonOf(byAssignee.overdue), pending: topPersonOf(byAssignee.pending) }}
    />
  );
}
