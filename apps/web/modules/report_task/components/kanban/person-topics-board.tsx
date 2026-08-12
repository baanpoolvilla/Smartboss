"use client";

import { useMemo } from "react";
import { ArrowLeft, FolderKanban, SearchX } from "lucide-react";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { DueDateBadge } from "@/modules/report_task/components/shared/due-date-badge";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getUser } from "@/modules/report_task/lib/directory";
import { statusMeta } from "@/modules/report_task/lib/task-meta";

const UNSORTED_KEY = "__none__";

/**
 * Full-screen replacement for the board (not a popup) — reached by clicking
 * a person's column header while the board is grouped by "ผู้รับผิดชอบ" (see
 * `?person=` in kanban-board.tsx). Every task that person is on, across the
 * whole board (not just whatever was filtered on the way in), laid out as
 * one column per project topic — same column look as the main board — plus
 * an "ไม่มีหัวข้อ" column for tasks with none.
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

  const columns = useMemo(() => {
    const mine = allTasks
      .filter((t) => t.assigneeIds.includes(personId))
      .filter((t) => canSeeTask(t, viewingAsUserId));

    const byTopic = new Map<string, typeof mine>();
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
        <div className="flex-1 flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
          {columns.map((column) => (
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
              </div>

              <div className="flex-1 flex flex-col gap-2.5 p-2.5 rounded-xl min-h-[120px] bg-[var(--bg-soft)]/50">
                {column.tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onOpenTask(t.id)}
                    className="rounded-xl border border-[var(--line)] bg-white p-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:shadow-[0_8px_20px_-8px_rgba(16,24,40,0.2)] hover:-translate-y-0.5 transition-all"
                  >
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[10px] text-[var(--ink-soft)]">{statusMeta[t.status].label}</span>
                      <DueDateBadge task={t} className="ml-auto shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
