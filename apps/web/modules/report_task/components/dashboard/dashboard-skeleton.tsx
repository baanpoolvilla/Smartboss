import { Skeleton } from "@/modules/report_task/components/ui/skeleton";
import { DASHBOARD_CARD_STATIC } from "@/modules/report_task/components/dashboard/dashboard-card-style";
import { cn } from "@/modules/report_task/lib/utils";

/** Placeholder shown while the file-backed task data loads on the dashboard. */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-6 pt-4 lg:pt-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn(DASHBOARD_CARD_STATIC, "bg-white p-5 flex items-start justify-between")}>
            <div className="space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-14" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-10 w-10 rounded-xl" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={cn(DASHBOARD_CARD_STATIC, "bg-white p-5 space-y-4")}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[220px] w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
