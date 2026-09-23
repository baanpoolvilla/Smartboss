"use client";

import { FolderKanban } from "lucide-react";
import { TaskCard } from "./task-card";
import { ShowMoreToggle } from "@/modules/report_task/components/shared/show-more-toggle";
import { useShowMore } from "@/modules/report_task/hooks/use-show-more";
import { useIsMobile } from "@/modules/report_task/hooks/use-is-mobile";
import { dueUrgency } from "@/modules/report_task/lib/task-flags";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { chartColors, statusColors as statusAccent } from "@/modules/report_task/lib/chart-colors";
import type { Task } from "@/modules/report_task/types";

// เดียวกับที่ KanbanColumn ใช้ (คอลัมน์ปกติของบอร์ดหลัก) — จำกัดจำนวนการ์ดที่
// โชว์ก่อน แล้วกด "แสดงเพิ่มเติม" ทีละหน้า แทนที่จะปล่อยให้คอลัมน์ยาวเลื่อน
// ในตัวเองไม่จำกัด ("ให้แสดงเท่าอันนี้ถ้ามีเยอะให้กดแสดงเพิ่มเติมสิ")
const PAGE_SIZE = 6;
const MOBILE_PAGE_SIZE = 3;

export const statusBuckets = [
  { key: "todo" as const, label: statusMeta.todo.label, color: chartColors.gray },
  { key: "in_progress" as const, label: statusMeta.in_progress.label, color: statusAccent.in_progress },
  { key: "overdue" as const, label: "เลยกำหนด", color: chartColors.red },
  { key: "done" as const, label: statusMeta.done.label, color: statusAccent.done },
];

export function bucketOf(t: Task): (typeof statusBuckets)[number]["key"] {
  if (t.status !== "done" && dueUrgency(t) === "overdue") return "overdue";
  return t.status;
}

export interface TopicColumn {
  id: string;
  name: string;
  tasks: Task[];
}

/**
 * One column of PersonTopicsBoard/DepartmentTopicsBoard — header (name,
 * count, 4-way status-mix bar) + a capped, "แสดงเพิ่มเติม"-paged task list,
 * same shape both boards used to duplicate inline. Split out so a fix (like
 * the show-more paging here) only needs making once, not kept in sync by
 * hand across both files.
 */
export function TopicColumnCard({ column, onOpenTask }: { column: TopicColumn; onOpenTask: (taskId: string) => void }) {
  const counts = statusBuckets.map((b) => ({
    ...b,
    count: column.tasks.filter((t) => bucketOf(t) === b.key).length,
  }));
  const isMobile = useIsMobile();
  const { visible: visibleTasks, remaining, expanded, toggle } = useShowMore(column.tasks, isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE);

  return (
    <div className="flex h-full min-h-0 flex-col flex-1 basis-[300px] min-w-[280px] max-w-[400px] shrink-0">
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

      <div className="flex-1 flex flex-col gap-3 p-2.5 rounded-xl min-h-[200px] bg-[var(--bg-soft)]/50">
        {visibleTasks.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
        ))}
        <ShowMoreToggle expanded={expanded} remaining={remaining} onToggle={toggle} />
      </div>
    </div>
  );
}
