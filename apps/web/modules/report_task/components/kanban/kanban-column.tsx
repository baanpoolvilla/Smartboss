"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "./task-card";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";
import type { LucideIcon } from "lucide-react";

export interface BoardColumn {
  id: string;
  label: string;
  accent: string;
  icon?: LucideIcon;
  tasks: Task[];
}

export function KanbanColumn({
  column,
  onOpen,
  selected,
  onToggleSelect,
  selectMode,
}: {
  column: BoardColumn;
  onOpen: (id: string) => void;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  selectMode?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const Icon = column.icon;
  const accent = column.accent;

  return (
    <div
      id={`kanban-col-${column.id}`}
      className="flex flex-col flex-1 basis-[300px] min-w-[280px] max-w-[400px] shrink-0 transition-shadow duration-500"
    >
      <div className="rounded-xl bg-white border border-[var(--line)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] px-3.5 py-3 mb-3">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span
              className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, white)`, color: accent }}
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
          <h3 className="text-sm font-semibold truncate tracking-tight">{column.label}</h3>

          <span
            className="ml-auto text-[11px] font-semibold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center tabular-nums shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, white)`, color: accent }}
          >
            {column.tasks.length}
          </span>
        </div>
        <div className="h-[3px] rounded-full mt-2.5 -mb-0.5" style={{ backgroundColor: `color-mix(in srgb, ${accent} 35%, transparent)` }} />
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 flex flex-col gap-3 p-2.5 rounded-xl min-h-[200px] transition-colors duration-200",
          isOver ? "bg-[var(--accent)] ring-2 ring-inset ring-[var(--brand-green)]/30" : "bg-[var(--bg-soft)]/50"
        )}
      >
        <SortableContext items={column.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {column.tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              columnId={column.id}
              onOpen={onOpen}
              selected={selected?.has(t.id)}
              onToggleSelect={onToggleSelect}
              selectMode={selectMode}
            />
          ))}
        </SortableContext>

        {column.tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--ink-soft)] border border-dashed border-[var(--line)] rounded-lg py-8">
            ลากงานมาวางที่นี่
          </div>
        )}
      </div>
    </div>
  );
}
