"use client";

import { useMemo } from "react";
import {
  DndContext,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, FolderKanban, SearchX } from "lucide-react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { TaskCard } from "./task-card";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getUser } from "@/modules/report_task/lib/directory";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { chartColors, statusColors as statusAccent } from "@/modules/report_task/lib/chart-colors";
import { cn } from "@/modules/report_task/lib/utils";
import type { Task } from "@/modules/report_task/types";

const UNSORTED_KEY = "__none__";

// Same 4-way split as the main board's "จัดกลุ่มตามสถานะ" columns (see
// kanban-board.tsx) — todo/in_progress/done plus a derived "เลยกำหนด"
// bucket pulled out of whichever of the first two it came from, so every
// task lands in exactly one bucket.
const statusBuckets = [
  { key: "todo" as const, label: statusMeta.todo.label, color: chartColors.gray },
  { key: "in_progress" as const, label: statusMeta.in_progress.label, color: statusAccent.in_progress },
  { key: "overdue" as const, label: "เลยกำหนด", color: chartColors.red },
  { key: "done" as const, label: statusMeta.done.label, color: statusAccent.done },
];

function bucketOf(t: Task): (typeof statusBuckets)[number]["key"] {
  if (t.status !== "done" && dueUrgency(t) === "overdue") return "overdue";
  return t.status;
}

/**
 * Full-screen replacement for the board (not a popup) — reached by clicking
 * a person's column header while the board is grouped by "ผู้รับผิดชอบ" (see
 * `?person=` in kanban-board.tsx). Every task that person is on, across the
 * whole board (not just whatever was filtered on the way in), laid out as
 * one column per project topic — same column/card look as the main board,
 * including a real (non-draggable) TaskCard per task — plus an "ไม่มีหัวข้อ"
 * column for tasks with none. Each column's header bar shows the same 4-way
 * status split as the main board's status view, merged into one bar instead
 * of one column each.
 */
export function PersonTopicsBoard({
  personId,
  onBack,
  onOpenTask,
}: {
  personId: string;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const allTasks = useTaskStore((s) => s.tasks);
  const topics = useProjectTopicStore((s) => s.topics);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const person = getUser(personId);
  // No drag-and-drop here (nothing to reorder into) — an empty sensor list
  // just gives TaskCard's useSortable a context to mount in without ever
  // actually activating a drag.
  const sensors = useSensors();
  function noopDragEnd(_e: DragEndEvent) {}

  const columns = useMemo(() => {
    const mine = allTasks
      .filter((t) => t.assigneeIds.includes(personId))
      .filter((t) => canSeeTask(t, viewingAsUserId));

    const byTopic = new Map<string, Task[]>();
    for (const t of mine) {
      const key = t.projectTopicId ?? UNSORTED_KEY;
      const list = byTopic.get(key);
      if (list) list.push(t);
      else byTopic.set(key, [t]);
    }

    const named = topics
      .filter((topic) => byTopic.has(topic.id))
      .map((topic) => ({ id: topic.id, name: topic.name, tasks: byTopic.get(topic.id)! }));
    const unsorted = byTopic.get(UNSORTED_KEY);

    return unsorted ? [...named, { id: UNSORTED_KEY, name: "ไม่มีหัวข้อ", tasks: unsorted }] : named;
  }, [personId, allTasks, topics, viewingAsUserId]);

  const total = columns.reduce((n, c) => n + c.tasks.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--ink-soft)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] transition-colors shrink-0"
          aria-label="กลับไปบอร์ด"
          title="กลับไปบอร์ด"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarFallback className="text-[10px]">{person?.avatar}</AvatarFallback>
        </Avatar>
        <h2 className="text-sm font-semibold">งานของ {person?.name ?? "—"} แยกตามหัวข้อโปรเจค</h2>
        <span className="ml-auto text-xs text-[var(--ink-soft)]">{total} งาน</span>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={SearchX}
          title="ไม่มีงานที่มอบหมายอยู่"
          description={`${person?.name ?? "คนนี้"} ยังไม่มีงานที่รับผิดชอบตอนนี้`}
        />
      ) : (
        <DndContext id="person-topics-board" sensors={sensors} onDragEnd={noopDragEnd}>
          <div className="flex-1 flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
            {columns.map((column) => {
              const counts = statusBuckets.map((b) => ({
                ...b,
                count: column.tasks.filter((t) => bucketOf(t) === b.key).length,
              }));
              return (
                <div key={column.id} className="flex flex-col flex-1 basis-[300px] min-w-[280px] max-w-[400px] shrink-0">
                  <div className="rounded-xl bg-white border border-[var(--line)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] px-3.5 py-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-[var(--accent)] text-[var(--brand-green-dark)]">
                        <FolderKanban className="h-4 w-4" />
                      </span>
                      <h3 className="text-sm font-semibold truncate tracking-tight">{column.name}</h3>
                      <span className="ml-auto text-[11px] font-semibold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center tabular-nums shrink-0 bg-[var(--accent)] text-[var(--brand-green-dark)]">
                        {column.tasks.length}
                      </span>
                    </div>

                    {/* 4-way status split, merged into one bar (see statusBuckets) — hover a
                        segment for its label/count, legend row underneath spells it out. */}
                    <div className="mt-2.5">
                      <div className="h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden flex">
                        {counts.map((b) =>
                          b.count > 0 ? (
                            <div
                              key={b.key}
                              className="h-full"
                              style={{ width: `${(b.count / column.tasks.length) * 100}%`, backgroundColor: b.color }}
                              title={`${b.label} ${b.count}`}
                            />
                          ) : null
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {counts
                          .filter((b) => b.count > 0)
                          .map((b) => (
                            <span key={b.key} className="flex items-center gap-1 text-[10px] text-[var(--ink-soft)]">
                              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                              {b.label} {b.count}
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex-1 flex flex-col gap-3 p-2.5 rounded-xl min-h-[200px] bg-[var(--bg-soft)]/50"
                    )}
                  >
                    <SortableContext items={column.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      {column.tasks.map((t) => (
                        <TaskCard key={t.id} task={t} columnId={column.id} onOpen={onOpenTask} />
                      ))}
                    </SortableContext>
                  </div>
                </div>
              );
            })}
          </div>
        </DndContext>
      )}
    </div>
  );
}
