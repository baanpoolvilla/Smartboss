import { ProjectView } from "@/modules/report_task/components/projects/project-view";
import { TaskDataGate } from "@/modules/report_task/components/shared/task-data-gate";
import { Skeleton } from "@/modules/report_task/components/ui/skeleton";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TaskDataGate fallback={<Skeleton className="h-[560px] w-full rounded-xl" />}>
      <ProjectView projectId={id} />
    </TaskDataGate>
  );
}
