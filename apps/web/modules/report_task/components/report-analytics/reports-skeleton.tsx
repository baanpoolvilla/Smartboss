import { Skeleton } from "@/modules/report_task/components/ui/skeleton";

/** Placeholder shown while the file-backed task data loads on the reports page. */
export function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--line)] bg-white p-5 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--line)] bg-white p-5 space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-[170px] w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[var(--line)] bg-white p-5 space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
