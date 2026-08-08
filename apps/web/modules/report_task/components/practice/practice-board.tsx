"use client";

import { useState } from "react";
import { usePracticeStore, type PracticeTask } from "@/modules/report_task/store/practice-store";
import { usePracticeMissionStore } from "@/modules/report_task/store/practice-mission-store";
import { PracticeTaskCard } from "@/modules/report_task/components/practice/practice-task-card";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { cn } from "@/modules/report_task/lib/utils";
import type { TaskStatus } from "@/modules/report_task/types";
import { Plus } from "lucide-react";

const columns: TaskStatus[] = ["todo", "in_progress", "done"];

export function PracticeBoard({
  onOpenTask,
  onCreateTask,
  highlightTarget,
}: {
  onOpenTask: (id: string) => void;
  onCreateTask: () => void;
  /** Which mission is currently asking for attention — "drag-card" glows every card, everything else stays plain (those missions live inside the task dialog instead). */
  highlightTarget: string | null;
}) {
  const tasks = usePracticeStore((s) => s.tasks);
  const moveTask = usePracticeStore((s) => s.moveTask);
  const completeMission = usePracticeMissionStore((s) => s.complete);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function handleDrop(status: TaskStatus) {
    if (!draggingId) return;
    const task = tasks.find((t) => t.id === draggingId);
    if (task && task.status !== status) {
      moveTask(draggingId, status);
      completeMission("drag-card");
      if (status === "done") completeMission("complete-task");
    }
    setDraggingId(null);
    setDragOverColumn(null);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {columns.map((status) => {
        const meta = statusMeta[status];
        const columnTasks = tasks.filter((t) => t.status === status);
        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverColumn(status);
            }}
            onDragLeave={() => setDragOverColumn((c) => (c === status ? null : c))}
            onDrop={() => handleDrop(status)}
            className={cn(
              "rounded-2xl border-t-4 bg-[var(--bg-soft)]/60 p-3 space-y-2.5 min-h-[280px] transition-colors",
              meta.column,
              dragOverColumn === status && "bg-[var(--accent)]/50 ring-2 ring-[var(--brand-green)]/40"
            )}
          >
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                <span className="text-xs font-semibold">{meta.label}</span>
              </div>
              <span className="text-[11px] text-[var(--ink-soft)] tabular-nums">{columnTasks.length}</span>
            </div>

            {columnTasks.map((task: PracticeTask) => (
              <PracticeTaskCard
                key={task.id}
                task={task}
                onOpen={() => onOpenTask(task.id)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingId(task.id);
                }}
                highlight={highlightTarget === "drag-card"}
              />
            ))}

            {status === "todo" && (
              <button
                type="button"
                onClick={onCreateTask}
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-2.5 text-xs font-medium text-[var(--ink-soft)] hover:border-[var(--brand-green)] hover:text-[var(--brand-green-dark)] transition-colors",
                  highlightTarget === "create-task" ? "border-[var(--brand-green)] text-[var(--brand-green-dark)] animate-[practice-pulse_1.6s_ease-in-out_infinite]" : "border-[var(--line)]"
                )}
              >
                <Plus className="h-3.5 w-3.5" /> สร้างงาน
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
