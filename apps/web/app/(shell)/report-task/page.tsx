"use client";

import { DashboardFilters } from "@/modules/report_task/components/dashboard/dashboard-filters";
import { DashboardGrid } from "@/modules/report_task/components/dashboard/dashboard-grid";
import { DashboardSkeleton } from "@/modules/report_task/components/dashboard/dashboard-skeleton";
import { ActiveFilterChips } from "@/modules/report_task/components/dashboard/active-filter-chips";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";

export default function DashboardPage() {
  const tasksLoaded = useTaskStore((s) => s.loaded);
  // The Report widgets read report-feed-store directly — wait for its own
  // server-synced load too, so they don't flash empty/zero before
  // populating a beat after the task widgets do.
  const reportFeedLoaded = useReportFeedStore((s) => s.loaded);
  const loaded = tasksLoaded && reportFeedLoaded;

  if (!loaded) {
    return (
      <div className="flex flex-col gap-8 pb-8">
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      {/* No page title here — the breadcrumb in Topbar already says "หน้าหลัก" */}
      <StickyFilterBar activeChips={<ActiveFilterChips />}>
        <DashboardFilters />
      </StickyFilterBar>
      <DashboardGrid editing={false} />
    </div>
  );
}
