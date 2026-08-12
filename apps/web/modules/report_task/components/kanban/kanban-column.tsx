"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "./task-card";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";
import type { LucideIcon } from "lucide-react";

export interface BoardColumn {
  id: string;
  label: string;
  accent: string;
  icon?: LucideIcon;
  tasks: Task[];
  /** Computed from due dates, not a real grouped attribute — can't be a drop target (§5). */
  derived?: boolean;
  /** Overrides the generic "ลากงานมาวางที่นี่" empty state — the derived
   * "เลยกำหนด" column can't accept drops, so that copy would be misleading. */
  emptyMessage?: string;
}

const PAGE_SIZE = 6;

export function KanbanColumn({
  column,
  boardTotal,
  onOpen,
}: {
  column: BoardColumn;
  /** Every task currently on the board (post-filter) — the denominator for this column's "N% ของบอร์ด" bar. */
  boardTotal: number;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: column.derived });
  const Icon = column.icon;
  const accent = column.accent;
  const percent = boardTotal > 0 ? Math.round((column.tasks.length / boardTotal) * 100) : 0;

  // §6 — every column caps at PAGE_SIZE cards up front (same constant for
  // every column, so all columns stay in sync scrolling-wise before anyone
  // expands); "ดูเพิ่มเติม" reveals the rest, "แสดงน้อยลง" collapses back —
  // same two-way toggle as the Dashboard's capped lists
  // (useShowMore/ShowMoreToggle), not a one-way "keep clicking to add more"
  // with no way back.
  const { visible: visibleTasks, remaining, expanded, toggle } = useShowMore(column.tasks, PAGE_SIZE);

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
          {/* จุดสี — a second, plainer color cue beyond the icon chip, right against the label. */}
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />
          <h3 className="text-sm font-semibold truncate tracking-tight">{column.label}</h3>

          <span
            className="ml-auto text-[11px] font-semibold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center tabular-nums shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, white)`, color: accent }}
          >
            {column.tasks.length}
          </span>
        </div>

        {/* Proportion of the whole (filtered) board this column holds — same
            accent as the rest of the header, not a fixed decorative tint. */}
        <div className="mt-2.5">
          <div className="h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${percent}%`, backgroundColor: accent }}
            />
          </div>
          <p className="text-[10px] font-medium mt-1" style={{ color: accent }}>
            {percent}% ของบอร์ด
          </p>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          // §5 — every column shares the exact same surface; columns are
          // told apart only by the header's dot/icon/count color and this
          // bar's fill, never by a tinted drop-zone background.
          "flex-1 flex flex-col gap-3 p-2.5 rounded-xl min-h-[200px] transition-colors duration-200 bg-[var(--bg-soft)]/50",
          isOver && !column.derived && "bg-[var(--accent)] ring-2 ring-inset ring-[var(--brand-green)]/30"
        )}
      >
        <SortableContext items={visibleTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {visibleTasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              columnId={column.id}
              onOpen={onOpen}
              showOriginalStatus={column.derived}
            />
          ))}
        </SortableContext>

        <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />

        {column.tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--ink-soft)] border border-dashed border-[var(--line)] rounded-lg py-8 text-center px-3">
            {column.emptyMessage ?? "ลากงานมาวางที่นี่"}
          </div>
        )}
      </div>
    </div>
  );
}
