"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { DashboardHero } from "@/modules/report_task/components/dashboard/dashboard-hero";
import { DashboardFilters } from "@/modules/report_task/components/dashboard/dashboard-filters";
import { DashboardGrid } from "@/modules/report_task/components/dashboard/dashboard-grid";
import { DashboardCustomizeBar } from "@/modules/report_task/components/dashboard/dashboard-customize-bar";
import { DashboardSkeleton } from "@/modules/report_task/components/dashboard/dashboard-skeleton";
import { Button } from "@/modules/report_task/components/ui/button";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";

export default function DashboardPage() {
  const [editing, setEditing] = useState(false);
  const tasksLoaded = useTaskStore((s) => s.loaded);
  // The Report widgets read report-feed-store directly — wait for its own
  // server-synced load too, so they don't flash empty/zero before
  // populating a beat after the task widgets do.
  const reportFeedLoaded = useReportFeedStore((s) => s.loaded);
  const loaded = tasksLoaded && reportFeedLoaded;

  return (
    <div className="flex flex-col gap-8 pb-8">
      {/* Header — greeting, filters (search/date/scope), customize */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <DashboardHero />
        {!editing && (
          <Button data-tour="dashboard-customize" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            ปรับแต่ง
          </Button>
        )}
      </div>

      {!loaded ? (
        <DashboardSkeleton />
      ) : (
        <>
          <DashboardFilters />
          {editing && <DashboardCustomizeBar onDone={() => setEditing(false)} />}
          <DashboardGrid editing={editing} />
        </>
      )}
    </div>
  );
}
