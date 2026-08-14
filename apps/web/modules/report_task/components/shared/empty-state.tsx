import type { LucideIcon } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

/**
 * Shared empty-state block so "nothing here" reads the same everywhere:
 * a soft icon badge, a title, an optional line, and an optional action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = "neutral",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  tone?: "neutral" | "good";
}) {
  const badge = tone === "good" ? "bg-[var(--accent)] text-[var(--chart-green)]" : "bg-[var(--bg-soft)] text-[var(--ink-soft)]";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-16 px-4 text-center rounded-xl border border-dashed border-[var(--line)]",
        className
      )}
    >
      <span className={cn("h-12 w-12 rounded-full flex items-center justify-center", badge)}>
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs text-[var(--ink-soft)] max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
