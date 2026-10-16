import { Suspense } from "react";

import { ProjectTemplatesPage } from "@/modules/report_task/components/projects/project-templates-page";
import { Skeleton } from "@/modules/report_task/components/ui/skeleton";

export default function ProjectTemplatesRoute() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-xl" />}>
      <ProjectTemplatesPage />
    </Suspense>
  );
}
