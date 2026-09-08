import { CalendarView } from "@/modules/report_task/components/calendar/calendar-view";
import { TaskDataGate } from "@/modules/report_task/components/shared/task-data-gate";
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
    // Full-bleed: cancel the module scaffold's own outer padding
    // (px-4 py-4 sm:px-6 sm:py-5, applied in components/module/app-scaffold.tsx)
    // and re-apply a tight one, so the calendar sits flush to the page edges
    // and fills the viewport ("เต็มหน้าพอดี") instead of floating inside
    // ~24px margins. The negative x-margins reclaim the side padding; the
    // negative top pull-up lets FullCalendarView's height math (which measures
    // from its own top down to the viewport bottom) grow the grid taller too.
    <div className="flex flex-col gap-4 lg:gap-6 -mx-4 -mt-4 px-2 pt-2 pb-4 sm:-mx-6 sm:-mt-5 sm:px-3 sm:pt-3">
      <TaskDataGate fallback={<CalendarSkeleton />}>
        <CalendarView />
      </TaskDataGate>
    </div>
  );
}
