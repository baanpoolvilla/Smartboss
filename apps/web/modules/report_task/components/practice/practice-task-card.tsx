"use client";

import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { getUser } from "@/modules/report_task/lib/directory";
import { priorityMeta } from "@/modules/report_task/lib/task-meta";
import { cn } from "@/modules/report_task/lib/utils";
import type { PracticeTask } from "@/modules/report_task/store/practice-store";
import { MessageSquare } from "lucide-react";

export function PracticeTaskCard({
  task,
  onOpen,
  onDragStart,
  highlight,
}: {
  task: PracticeTask;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
  /** A brief glow while this card is the thing the current mission wants touched — a spotlight-style nudge without a separate overlay component. */
  highlight?: boolean;
}) {
  const pMeta = priorityMeta[task.priority];
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className={cn(
        "w-full text-left rounded-xl border bg-[var(--bg)] p-3 space-y-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-grab active:cursor-grabbing",
        highlight ? "border-[var(--brand-green)] ring-2 ring-[var(--brand-green)]/30 animate-[practice-pulse_1.6s_ease-in-out_infinite]" : "border-[var(--line)]"
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: pMeta.accentColor }}
    >
      <p className="text-sm font-medium leading-snug">{task.title}</p>
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", pMeta.badgeClass)}>
          {pMeta.label}
        </Badge>
        <div className="flex items-center gap-1.5">
          {task.comments.length > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-[var(--ink-soft)]">
              <MessageSquare className="h-3 w-3" />
              {task.comments.length}
            </span>
          )}
          <div className="flex -space-x-1.5">
            {task.assigneeIds.slice(0, 3).map((id) => {
              const u = getUser(id);
              if (!u) return null;
              return (
                <Avatar key={id} className="h-5 w-5 ring-2 ring-[var(--bg)]">
                  <AvatarFallback className="text-[8px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{u.avatar}</AvatarFallback>
                </Avatar>
              );
            })}
          </div>
        </div>
      </div>
    </button>
  );
}
