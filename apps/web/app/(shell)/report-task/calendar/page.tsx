import { CalendarView } from "@/modules/report_task/components/calendar/calendar-view";
import { TaskDataGate } from "@/modules/report_task/components/shared/task-data-gate";
import { StickyFilterBar } from "@/modules/report_task/components/shared/sticky-filter-bar";
import { Skeleton } from "@/modules/report_task/components/ui/skeleton";

function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-56 rounded-lg" />
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>
      <Skeleton className="h-[560px] w-full rounded-xl" />
    </div>
  );
}

export default function CalendarPage() {
  return (
    <div className="flex flex-col gap-4 lg:gap-6 pb-6">
      <StickyFilterBar />
      <TaskDataGate fallback={<CalendarSkeleton />}>
        <CalendarView />
      </TaskDataGate>
    </div>
  );
}
