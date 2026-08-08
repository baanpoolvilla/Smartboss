import type { ReactNode } from "react";
import { cn } from "@/modules/report_task/lib/utils";

/** Shared page title block so every top-level page (Dashboard, Tasks, Calendar,
 *  Reports, Settings, ...) reads with the same title/subtitle hierarchy instead
 *  of each page reinventing its own heading size. */
export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(action && "flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-[var(--ink-soft)] mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
