import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** One consistent empty state for every tab panel (3.5.3) — โพสต์ already had
 * an icon+message+CTA; อัลบั้ม/ลิงก์ were a single line of gray text floating
 * near the top with no icon and no action, reading as a broken page next to
 * the others. */
export function TopicEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center px-6 py-14">
      <div className="h-14 w-14 rounded-full bg-[var(--accent)] flex items-center justify-center">
        <Icon className="h-6 w-6 text-[var(--brand-green-dark)]" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-xs text-[var(--ink-soft)] max-w-xs">{description}</p>}
      </div>
      {action}
    </div>
  );
}
