import { ProjectsPortfolio } from "@/modules/report_task/components/projects/projects-portfolio";
import { TaskDataGate } from "@/modules/report_task/components/shared/task-data-gate";
import { Skeleton } from "@/modules/report_task/components/ui/skeleton";

export default function ProjectsPage() {
  return (
    <TaskDataGate fallback={<Skeleton className="h-[420px] w-full rounded-xl" />}>
      <ProjectsPortfolio />
    </TaskDataGate>
  );
}
