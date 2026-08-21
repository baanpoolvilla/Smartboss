"use client";

import { TaskCard } from "./task-card";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { chartColors } from "@/modules/report_task/lib/chart-colors";
import type { Task, TaskStatus } from "@/modules/report_task/types";
import type { LucideIcon } from "lucide-react";

export interface BoardColumn {
  id: string;
  label: string;
  accent: string;
  icon?: LucideIcon;
  tasks: Task[];
  /** Computed from due dates, not a real grouped attribute — a task never
   * "belongs" to this column directly, it just currently qualifies. */
  derived?: boolean;
  /** Overrides the generic empty-column message — the derived "เลยกำหนด"
   * column gets its own celebratory copy instead. */
  emptyMessage?: string;
}

const PAGE_SIZE = 6;

export function KanbanColumn({
  column,
  boardTotal,
  onOpen,
  onHeaderClick,
  groupedByPriority,
  groupedByStatus,
}: {
  column: BoardColumn;
  /** Every task currently on the board (post-filter) — the denominator for this column's "N% ของบอร์ด" bar. */
  boardTotal: number;
  onOpen: (id: string) => void;
  /** Set only when grouped by assignee — clicking the person's name opens
   * their tasks broken down by project topic. Absent for status/priority
   * columns, which don't map to a single person. */
  onHeaderClick?: () => void;
  /** Passed straight through to each card — see TaskCard's own doc. */
  groupedByPriority?: boolean;
  /** A normal (non-derived) status column is, by definition, 100% one status
   * — every task in "กำลังทำ" already IS "กำลังทำ". Repeating that as a
   * legend chip under the bar ("● กำลังทำ N") just restated the header
   * label/count back at itself, so the by-status split is skipped here in
   * favor of an on-time/overdue split instead (see isPlainStatusColumn) —
   * still shown for the derived "รอตรวจสอบ" column and for priority/assignee
   * grouping, where a column can genuinely mix statuses. */
  groupedByStatus?: boolean;
}) {
  const Icon = column.icon;
  const accent = column.accent;
  const percent = boardTotal > 0 ? Math.round((column.tasks.length / boardTotal) * 100) : 0;
  // The header's icon chip/count/% text used to just be `accent` itself —
  // fine for a saturated color like the amber/red/gray accents, but the
  // derived "รอตรวจสอบ" column's accent (chartColors.greenPale, a pale
  // sage) is barely visible as text on its own pale-tint background. Darken
  // it for text specifically so every column stays legible regardless of
  // how light its own accent is, while the background tint and the little
  // dot (still solid `accent`) keep the light/dark cue between columns.
  const textAccent = `color-mix(in srgb, ${accent} 55%, black)`;

  // A column can mix statuses (every assignee column does; the derived
  // "รอตรวจสอบ" column is always 100% "done" though, so this stays flat
  // there) — a single-accent-color bar couldn't say which. Segment it by
  // each task's own status instead so "what kind of tasks does this person
  // actually have" reads at a glance without opening a single card.
  const statusOrder: TaskStatus[] = ["todo", "in_progress", "done"];
  const statusCounts = statusOrder.map((s) => ({
    status: s,
    count: column.tasks.filter((t) => t.status === s).length,
  }));

  // "รอดำเนินการ"/"กำลังทำ" no longer have a separate "เลยกำหนด" column to
  // drain into — a late task just stays here. The plain status-segmented bar
  // above is a no-op for these two (100% one status, by definition), so they
  // get their own split instead: on-time in the column's own accent, late in
  // the same red DueDateBadge already uses on the card itself, so a column
  // full of red reads as "everything in here is late" at a glance.
  const isPlainStatusColumn = groupedByStatus && !column.derived;
  const overdueCount = isPlainStatusColumn
    ? column.tasks.filter((t) => t.status !== "done" && dueUrgency(t) === "overdue").length
    : 0;
  const onTimeCount = column.tasks.length - overdueCount;

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
      className="flex h-full min-h-0 flex-1 basis-[300px] min-w-[280px] max-w-[400px] shrink-0 flex-col transition-shadow duration-500"
    >
      <div className="shrink-0 rounded-xl bg-white border border-[var(--line)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] px-3.5 py-3 mb-3">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span
              className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, white)`, color: textAccent }}
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
          {/* จุดสี — a second, plainer color cue beyond the icon chip, right against the label. */}
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />
          {onHeaderClick ? (
            <button
              type="button"
              onClick={onHeaderClick}
              className="text-sm font-semibold truncate tracking-tight text-left hover:underline underline-offset-2 cursor-pointer"
              title="ดูงานของคนนี้แยกตามหัวข้อโปรเจค"
            >
              {column.label}
            </button>
          ) : (
            <h3 className="text-sm font-semibold truncate tracking-tight">{column.label}</h3>
          )}

          <span
            className="ml-auto text-[11px] font-semibold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center tabular-nums shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, white)`, color: textAccent }}
          >
            {column.tasks.length}
          </span>
        </div>

        {/* "รอดำเนินการ"/"กำลังทำ" segment on-time-vs-late (their own accent +
            red) since a plain status split would just be 100% one color;
            every other column keeps the by-status split (see statusCounts'
            own doc). Either way, the legend line underneath always spells out
            the actual counts — a color-only bar can't be read precisely. */}
        <div className="mt-2.5">
          {column.tasks.length === 0 ? (
            <div className="h-1.5 rounded-full bg-[var(--bg-soft)]" />
          ) : isPlainStatusColumn ? (
            <div
              className="flex h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden"
              title={overdueCount > 0 ? `${column.label} ${onTimeCount} · เลยกำหนด ${overdueCount}` : `${column.label} ${onTimeCount}`}
            >
              {onTimeCount > 0 && (
                <div
                  className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-300"
                  style={{ width: `${(onTimeCount / column.tasks.length) * 100}%`, backgroundColor: accent }}
                />
              )}
              {overdueCount > 0 && (
                <div
                  className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-300"
                  style={{ width: `${(overdueCount / column.tasks.length) * 100}%`, backgroundColor: chartColors.red }}
                />
              )}
            </div>
          ) : (
            <div className="flex h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden" title={statusCounts.map((s) => `${statusMeta[s.status].label} ${s.count}`).join(" · ")}>
              {statusCounts
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div
                    key={s.status}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-300"
                    style={{ width: `${(s.count / column.tasks.length) * 100}%`, backgroundColor: statusMeta[s.status].accentColor }}
                  />
                ))}
            </div>
          )}
          <div className="flex items-center gap-2.5 mt-1 flex-wrap">
            <p className="text-[10px] font-medium" style={{ color: textAccent }}>
              {percent}% ของบอร์ด
            </p>
            {isPlainStatusColumn ? (
              // Only worth spelling out once the bar is actually split —
              // with no overdue tasks this column is 100% one color/status
              // already, and repeating "{label} {count}" here would just
              // restate the header's own name/count badge back at itself.
              overdueCount > 0 && (
                <>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--ink-soft)]">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                    {column.label} {onTimeCount}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: chartColors.red }}>
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: chartColors.red }} />
                    เลยกำหนด {overdueCount}
                  </span>
                </>
              )
            ) : (
              statusCounts
                .filter((s) => s.count > 0)
                .map((s) => (
                  <span key={s.status} className="flex items-center gap-1 text-[10px] text-[var(--ink-soft)]">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: statusMeta[s.status].accentColor }} />
                    {statusMeta[s.status].label} {s.count}
                  </span>
                ))
            )}
          </div>
        </div>
      </div>

      <div
        // Every column shares the exact same surface; columns are told
        // apart only by the header's dot/icon/count color and this bar's
        // fill. min-h-0 is the classic flex-child-with-overflow fix —
        // without it this column keeps growing to fit every card instead of
        // scrolling its own list within the board's fixed row height (see
        // kanban-board.tsx's scroller comment).
        className="flex-1 flex flex-col gap-3 p-2.5 rounded-xl min-h-[200px] lg:min-h-0 lg:overflow-y-auto transition-colors duration-200 bg-[var(--bg-soft)]/50"
      >
        {visibleTasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onOpen={onOpen}
            showOriginalStatus={column.derived}
            groupedByPriority={groupedByPriority}
          />
        ))}

        <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />

        {column.tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--ink-soft)] border border-dashed border-[var(--line)] rounded-lg py-8 text-center px-3">
            {column.emptyMessage ?? "ยังไม่มีงานในสถานะนี้"}
          </div>
        )}
      </div>
    </div>
  );
}
