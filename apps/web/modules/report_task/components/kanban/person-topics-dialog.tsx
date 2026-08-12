"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/modules/report_task/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { DueDateBadge } from "@/modules/report_task/components/shared/due-date-badge";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useProjectTopicStore } from "@/modules/report_task/store/project-topic-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { getUser } from "@/modules/report_task/lib/directory";
import { statusMeta } from "@/modules/report_task/lib/task-meta";
import { FolderKanban } from "lucide-react";

const UNSORTED_KEY = "__none__";

/**
 * Opened by clicking a person's column header on the Kanban board while
 * grouped by "ผู้รับผิดชอบ" — every task that person is on, across the whole
 * board (not just whatever's currently filtered), broken into one section
 * per project topic plus an "ไม่มีหัวข้อ" bucket for tasks with none.
 */
export function PersonTopicsDialog({
  personId,
  onOpenChange,
  onOpenTask,
}: {
  personId: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const allTasks = useTaskStore((s) => s.tasks);
  const topics = useProjectTopicStore((s) => s.topics);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const person = personId ? getUser(personId) : null;

  const groups = useMemo(() => {
    if (!personId) return [];
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

  const total = groups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <Dialog open={!!personId} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Avatar className="h-6 w-6 shrink-0">
              <AvatarFallback className="text-[10px]">{person?.avatar}</AvatarFallback>
            </Avatar>
            งานของ {person?.name ?? "—"}
          </DialogTitle>
        </DialogHeader>

        {total === 0 ? (
          <p className="text-sm text-[var(--ink-soft)] px-1 py-4 text-center">ไม่มีงานที่มอบหมายอยู่</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {groups.map((group) => (
              <div key={group.id} className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
                  <FolderKanban className="h-3.5 w-3.5" />
                  {group.name}
                  <span className="text-[var(--ink-soft)] font-normal">({group.tasks.length})</span>
                </div>
                <div className="space-y-1">
                  {group.tasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      className="w-full flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-left hover:bg-[var(--bg-soft)] hover:border-[var(--border-strong)] transition-colors"
                    >
                      <span className="flex-1 min-w-0 truncate text-sm">{t.title}</span>
                      <span className="text-[10px] text-[var(--ink-soft)] shrink-0">{statusMeta[t.status].label}</span>
                      <DueDateBadge task={t} className="shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
